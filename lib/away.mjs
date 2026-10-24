// Away Responder for Chamber.
//
// Makes the "Ashish was in a meeting, his agent answered" story 100% real across
// ALL harnesses (Claude Code, Codex, Antigravity, and DeepSeek), not just Claude's idle hook.
//
// Runs locally as `<owner>/away` with answers: true and a lower priority (-1), so an active
// developer agent gets asked first if online. When the developer is away, this responder
// queries the local ChamberSearch index, contracts, and team memory to answer questions
// directly and cite source files.

import { LineClient } from "./client.mjs";
import { describe, Inbox, loadConfig } from "./inbox.mjs";
import { modelKey, DEFAULT_MODEL } from "./dream.mjs";
import { ChamberSearch } from "./search.mjs";
import { TeamMemory } from "./memory.mjs";

export class AwayResponder {
  constructor(config = loadConfig(), { cwd = process.cwd(), statusMessage = "away in a meeting" } = {}) {
    if (!config) throw new Error("not in a chamber yet (run chamber join or chamber new)");
    this.config = config;
    this.owner = config.owner;
    this.cwd = cwd;
    this.statusMessage = statusMessage;
    this.agent = `${this.owner}/away`;
    this.search = new ChamberSearch(this.owner);
    this.memory = new TeamMemory(config.invite, this.agent);
    this.inbox = new Inbox(this.agent);
    this.client = null;
    this.running = false;
  }

  async start() {
    this.client = new LineClient(this.config.invite, this.agent, {
      kind: "away-responder",
      label: `Away responder for ${this.owner} (${this.statusMessage})`,
      priority: -1, // lower priority than interactive agents
      answers: true,
      onMessage: (msg) => this.#handleMessage(msg),
    });

    this.client.run();
    await this.client.ready();
    this.running = true;
    return this;
  }

  async stop() {
    this.running = false;
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this.search.close();
  }

  async #handleMessage(message) {
    if (!this.running) return;
    // Don't reply to our own messages or broadcasts
    if (message.from.startsWith(`${this.owner}/`) || message.to === "*") return;

    // Check if this is a question directed to us
    const text = message.text || "";
    if (!text.trim()) return;

    // 1. Search local memory and indexed talks for context
    const searchHits = await this.search.search({ query: text, limit: 3 });
    const memoryHits = await this.memory.search(text.split(/\s+/).slice(0, 3).join(" "));

    let synthesizedAnswer = "";
    const key = modelKey();

    if (key) {
      // Use configured model to generate a factual, concise response citing files
      try {
        const prompt = [
          `You are an automated away responder for ${this.owner}, who is currently ${this.statusMessage}.`,
          `A teammate's coding agent (${message.from}) asked: "${text}".`,
          `Here is relevant local team memory and past discussions:`,
          ...memoryHits.slice(0, 3).map((h) => `- ${h.path}:${h.line}: ${h.text}`),
          ...searchHits.slice(0, 3).map((s) => `- [${s.citation}]: ${s.text}`),
          "",
          `Answer their question accurately and concisely based ONLY on the context above. If the context contains a schema, contract, or type, state it clearly and cite the file. If you do not have enough information, politely say ${this.owner} will review their question upon returning.`,
        ].join("\n");

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            max_tokens: 400,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          synthesizedAnswer = data?.choices?.[0]?.message?.content?.trim() || "";
        }
      } catch {
        // Fall back to rule-based response
      }
    }

    if (!synthesizedAnswer) {
      if (memoryHits.length > 0) {
        synthesizedAnswer = `${this.owner} is ${this.statusMessage}. From team memory (${memoryHits[0].path}):\n${memoryHits[0].text}`;
      } else if (searchHits.length > 0) {
        synthesizedAnswer = `${this.owner} is ${this.statusMessage}. From past discussion (${searchHits[0].citation}):\n${searchHits[0].text}`;
      } else {
        synthesizedAnswer = `${this.owner} is currently ${this.statusMessage}. Your question has been delivered to their inbox.`;
      }
    }

    // Send reply back into thread
    const to = String(message.to || "").startsWith("#") ? message.to : message.from;
    const thread = message.thread || message.id;
    const receipt = await this.client.send(to, synthesizedAnswer, {
      replyTo: message.id,
      thread,
      title: message.title,
    });
    this.inbox.sent(receipt, { to, text: synthesizedAnswer, replyTo: message.id, title: message.title });
  }
}
