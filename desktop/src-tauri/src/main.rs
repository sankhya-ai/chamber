// Chamber Desktop shell: starts the local chamber daemon itself, then shows its board.
// Nothing for the user to run: open the app, create or join a chamber.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent};

const PORT: u16 = 7878;
// The repository this app was built from: bin/chamber.mjs is the daemon.
const CLI: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../bin/chamber.mjs");

struct Daemon(Mutex<Option<Child>>);

/// The daemon this app runs: the bundled node and chamber (an installed app), else the checkout
/// it was built from (`cargo run`, install.sh).
fn start_daemon(app: &tauri::App) -> Option<Child> {
    let bundled = app.path().resource_dir().ok().map(|dir| dir.join("app/bin/chamber.mjs")).filter(|p| p.exists());
    let sidecar = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "node.exe" } else { "node" }))).filter(|p| p.exists());
    let bundled_run = sidecar.is_some() && bundled.is_some();
    let (node, cli) = match (sidecar, bundled) {
        (Some(node), Some(cli)) => (node.into_os_string(), cli.into_os_string()),
        _ => (option_env!("CHAMBER_NODE").unwrap_or("node").into(), CLI.into()),
    };
    let mut daemon = Command::new(node);
    // The bundled node tells the agents it sets up to use it too (nobody has to install Node).
    if bundled_run {
        daemon.env("CHAMBER_BUNDLED", "1");
    }
    #[cfg(windows)]
    daemon.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    daemon
        .args([cli.to_str()?, "board", "--no-open", "--port", &PORT.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let daemon = start_daemon(app);
            app.manage(Daemon(Mutex::new(daemon)));
            let window = app.get_webview_window("main").expect("main window");
            std::thread::spawn(move || {
                for _ in 0..100 {
                    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                        let _ = window.navigate(format!("http://127.0.0.1:{PORT}").parse().unwrap());
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building chamber desktop");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Daemon>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
