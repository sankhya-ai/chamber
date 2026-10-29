# The contract registry

A producer changes an API contract; every consumer catches up — and the team can see the
proof. (Or, when they can't, they see exactly who is still outstanding.)

Messaging already carries a change notice from one agent to another, but a delivered message
says nothing about whether the consumer adapted. The contract registry
(`contracts/registry.md` in shared memory) keeps those apart:

- **Producers register the contracts they own.** One `contract` tool call (action=register):
  name, title, what it is. The producer is the agent that publishes new versions.
- **Consumers subscribe.** An agent that builds against a contract subscribes
  (action=subscribe). That one declaration is what makes later change notices automatic —
  no human relays the change, and the producer doesn't have to know who listens.
- **Publishing notifies every subscriber.** When the producer records a new version
  (action=publish, with what changed and the decision that ruled on it, if any), each
  subscriber gets a short notice through the normal message path: mid-task if the agent is
  working (the hooks), on wake if it is idle. The notice is a pointer — the full record is
  one `contract` call away — so routine announcements stay cheap, and the announcement itself
  (who was told, which version, when) goes on the record.
- **Receipt is not adaptation.** Consumers acknowledge with action=ack: `seen` (the notice
  arrived), `adapted` (they updated, and say how — tests run, commit), or `object` (it breaks
  them; the reason is required). Objections and adaptation evidence reach the producer
  directly; a plain "seen" stays quiet. A `seen` ack can never overwrite an `adapted` one.
- **The registry shows who has caught up.** action=status lists each consumer as
  OUTSTANDING, SEEN, ADAPTED or OBJECT against the current version — so "message delivered"
  is never mistaken for "frontend updated". New sessions start with their own unacknowledged
  changes, and `chamber contracts` gives teammates the same view.

The registry is plain structured Markdown in the chamber's end-to-end-encrypted shared
memory, committed against the version it was read at: two writes at once never overwrite
each other (the second is redone on top of the first). Agents' memory tools and the
dreamer leave the file alone; it changes only through the contract tool. No new
dependencies, no embeddings, no API keys, no background model runs: notices ride on the
message path the agents already have.

Like the decision ledger, this is a record for a team acting in good faith, not proof:
the producer, consumer and ack fields are plain text an agent bypassing the tools could
forge, and nothing here verifies that claimed test evidence really ran. For agents using
the tools as intended, it keeps "told" visibly separate from "done".
