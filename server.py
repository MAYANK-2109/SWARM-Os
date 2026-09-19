import json
import os
import random
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "5173"))
LOCK = threading.Lock()

STATE = {
    "session": None,
    "workers": [],
    "task": None,
    "events": [],
    "notifications": [],
    "notificationSeq": 0,
}

def now_text():
    return time.strftime("%H:%M:%S")

def notify(target, title, message, kind="info"):
    STATE["notificationSeq"] += 1
    STATE["notifications"].append({
        "id": STATE["notificationSeq"],
        "target": target,
        "title": title,
        "message": message,
        "kind": kind,
        "time": now_text(),
    })
    STATE["notifications"] = STATE["notifications"][-80:]

def log_event(message):
    STATE["events"].insert(0, {"time": now_text(), "message": message})
    del STATE["events"][30:]

def find_worker(name):
    return next((w for w in STATE["workers"] if w["name"] == name), None)

def assignment_for_index(task, idx, worker_name=""):
    allocations = task.get("allocations") or []
    if not allocations:
        return {
            "range": task.get("range", "Assigned chunk"),
            "requiredData": task.get("requiredData", "Task-specific subset"),
            "reason": "Compatible worker",
        }
    # Prefer the named allocation when the receiver uses a demo device name.
    wn = worker_name.strip().lower()
    for alloc in allocations:
        if alloc.get("device", "").strip().lower() == wn:
            return alloc
    # Otherwise allocation[0] is usually owner-local, so external worker 0 gets allocation[1].
    pos = min(idx + 1, len(allocations) - 1)
    return allocations[pos]


def maybe_auto_start():
    task = STATE.get("task")
    if not task or task.get("status") != "Awaiting approval":
        return False
    requested = [w for w in STATE["workers"] if w.get("assignment") is not None]
    if not requested or any(w.get("decision") == "Waiting" for w in requested):
        return False
    accepted = [w for w in requested if w.get("decision") == "Accepted"]
    if not accepted:
        task["status"] = "No workers accepted"
        task["stage"] = "Request closed"
        notify("owner", "No receiver accepted", "The request ended without an accepted worker. Owner can run locally or resend.", "warning")
        log_event("Approval round ended with no accepted receivers.")
        return False
    task["status"] = "Active"
    task["stage"] = "Transfer assigned data"
    task["progress"] = max(5, task.get("progress", 0))
    task["ownerProgress"] = max(5, task.get("ownerProgress", 0))
    task["autoStartedAt"] = now_text()
    log_event(f"All requested devices responded. Execution auto-started with {len(accepted)} accepted receiver(s).")
    notify("owner", "Execution started automatically", f"{len(accepted)} accepted receiver(s) are now processing their assigned work.", "success")
    for w in accepted:
        w["status"] = "Working"
        notify(w["name"], "Execution started automatically", f"Your assigned {task['name']} work is now running.", "task")
    return True


def advance_task(delta=4):
    task = STATE.get("task")
    if not task or task.get("status") != "Active":
        return
    accepted = [w for w in STATE["workers"] if w.get("decision") == "Accepted"]
    if not accepted:
        return
    task["ownerProgress"] = min(100, task.get("ownerProgress", 5) + delta + 1)
    for idx, w in enumerate(accepted):
        speed_bonus = 2 if "ASUS" in w.get("name", "") else 1 if "iQOO" in w.get("name", "") else 0
        w["progress"] = min(100, w.get("progress", 0) + delta + speed_bonus)
        w["status"] = "Working" if w["progress"] < 100 else "Result returned"
    required = [task.get("ownerProgress", 0)] + [w.get("progress", 0) for w in accepted]
    task["progress"] = min(required) if required else task.get("progress", 0)
    p = task["progress"]
    if p < 20:
        task["stage"] = "Transfer assigned data"
    elif p < 82:
        task["stage"] = "Parallel execution"
    elif p < 100:
        task["stage"] = "Return results + merge"
    else:
        task["stage"] = "Completed"
        task["status"] = "Completed"
        task["completedAt"] = now_text()
        task["ownerProgress"] = 100
        for w in accepted:
            w["progress"] = 100
            w["status"] = "Completed"
            notify(w["name"], "Assigned work completed", "Result returned to the owner. Temporary task data can now be cleared.", "success")
        log_event("Task completed and results merged.")
        notify("owner", "Task completed", f"{task['name']} finished and results were merged.", "success")


def progress_engine():
    while True:
        time.sleep(0.85)
        with LOCK:
            advance_task(4)

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            with LOCK:
                return self._json(STATE)
        if path == "/api/info":
            return self._json({
                "port": PORT,
                "lanIp": lan_ip(),
                "lanUrl": f"http://{lan_ip()}:{PORT}",
                "localUrl": f"http://localhost:{PORT}"
            })
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._body()
        with LOCK:
            if path == "/api/session/create":
                code = f"SWARM-{random.randint(1000,9999)}"
                STATE["session"] = {
                    "code": code,
                    "owner": data.get("owner", "HP Victus 16"),
                    "status": "Open",
                    "createdAt": now_text(),
                }
                STATE["workers"] = []
                STATE["task"] = None
                STATE["events"] = []
                STATE["notifications"] = []
                STATE["notificationSeq"] = 0
                log_event(f"Session {code} created by {STATE['session']['owner']}.")
                notify("owner", "Swarm session ready", f"Invite workers with code {code}.", "success")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/session/join":
                if not STATE["session"] or data.get("code", "").strip().upper() != STATE["session"]["code"]:
                    return self._json({"ok": False, "error": "Join code not found."}, 404)
                name = (data.get("name") or "Worker Device").strip()
                existing = next((w for w in STATE["workers"] if w["name"].lower() == name.lower()), None)
                if not existing:
                    worker = {
                        "id": f"w{len(STATE['workers'])+1}",
                        "name": name,
                        "status": "Connected",
                        "decision": "Waiting",
                        "progress": 0,
                        "battery": int(data.get("battery", 76)),
                        "temperature": int(data.get("temperature", 37)),
                        "network": data.get("network", "Wi-Fi"),
                        "ram": data.get("ram", "8 GB"),
                        "cpu": data.get("cpu", "Auto-detected CPU"),
                        "gpu": data.get("gpu", "Compatible accelerator"),
                        "assignment": None,
                        "joinedAt": now_text(),
                    }
                    STATE["workers"].append(worker)
                    # New devices always appear immediately in the sender console. If a request is already open or running,
                    # keep the new device available rather than silently changing the existing split. The owner can resend
                    # the request before execution starts if they want the new device included.
                    if STATE.get("task") and STATE["task"].get("status") in ("Awaiting approval", "Active"):
                        worker["decision"] = "Available"
                        worker["status"] = "Connected - available"
                        notify("owner", "New device available", f"{name} joined after the current request. Resend before execution to include it in a fresh split.", "device")
                    log_event(f"{name} joined the swarm.")
                    notify("owner", "New device connected", f"{name} joined and is visible in the live swarm.", "device")
                    notify(name, "Connected to SwarmOS", f"Connected to {STATE['session']['owner']}. Wait for a task request.", "success")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/session/leave":
                name = data.get("name", "")
                before = len(STATE["workers"])
                STATE["workers"] = [w for w in STATE["workers"] if w["name"] != name]
                if len(STATE["workers"]) != before:
                    log_event(f"{name} left the swarm.")
                    notify("owner", "Device disconnected", f"{name} left the session.", "warning")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/task/request":
                if not STATE["session"]:
                    return self._json({"ok": False, "error": "Create a sender session first."}, 400)
                STATE["task"] = {
                    "workflowId": data.get("workflowId"),
                    "name": data.get("name"),
                    "connector": data.get("connector", "Connected source"),
                    "sourceLabel": data.get("sourceLabel", "Selected source"),
                    "requiredData": data.get("requiredData", "Task-specific subset"),
                    "executor": data.get("executor", "Compatible executor"),
                    "eta": data.get("eta", "~5 min"),
                    "localEstimate": data.get("localEstimate", "—"),
                    "saving": data.get("saving", "—"),
                    "objective": data.get("objective", "Fastest finish"),
                    "privacy": data.get("privacy", "Task-only data"),
                    "allocations": data.get("allocations", []),
                    "stage": "Waiting for device approval",
                    "progress": 0,
                    "ownerProgress": 0,
                    "status": "Awaiting approval",
                    "autoRun": True,
                    "createdAt": now_text(),
                }
                for idx, worker in enumerate(STATE["workers"]):
                    worker["decision"] = "Waiting"
                    worker["progress"] = 0
                    worker["assignment"] = assignment_for_index(STATE["task"], idx, worker["name"])
                    assignment = worker["assignment"] or {}
                    notify(
                        worker["name"],
                        "New SwarmOS task request",
                        f"{STATE['task']['name']} • {assignment.get('range', 'Assigned chunk')} • Tap to review.",
                        "task"
                    )
                log_event(f"Approval requests sent for {STATE['task']['name']}.")
                notify("owner", "Requests sent", f"Task request sent to {len(STATE['workers'])} connected receiver(s).", "success")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/session/decision":
                name = data.get("name", "")
                decision = data.get("decision", "Waiting")
                worker = find_worker(name)
                if worker:
                    worker["decision"] = decision
                    worker["status"] = "Approved - waiting for peers" if decision == "Accepted" else "Connected"
                    log_event(f"{name} {decision.lower()} the assigned task.")
                    notify("owner", f"{name}: {decision}", f"{name} {decision.lower()} the task request.", "success" if decision == "Accepted" else "warning")
                    notify(name, f"Task {decision.lower()}", "Accepted. Work will start automatically when the approval round is complete." if decision == "Accepted" else "No task data will be transferred.", "success" if decision == "Accepted" else "warning")
                    maybe_auto_start()
                return self._json({"ok": bool(worker), "state": STATE})

            if path == "/api/task/start":
                if not STATE["task"]:
                    return self._json({"ok": False, "error": "Send a task request first."}, 400)
                accepted = [w for w in STATE["workers"] if w["decision"] == "Accepted"]
                if not accepted:
                    return self._json({"ok": False, "error": "At least one receiver must accept before starting."}, 400)
                STATE["task"]["status"] = "Active"
                STATE["task"]["stage"] = "Transfer assigned data"
                STATE["task"]["progress"] = max(5, STATE["task"].get("progress", 0))
                STATE["task"]["ownerProgress"] = max(5, STATE["task"].get("ownerProgress", 0))
                log_event(f"Execution started with {len(accepted)} accepted worker(s).")
                notify("owner", "Distributed execution started", f"{len(accepted)} receiver(s) are now processing assigned data.", "success")
                for w in accepted:
                    w["status"] = "Working"
                    notify(w["name"], "Execution started", f"SwarmOS started your assigned {STATE['task']['name']} chunk.", "task")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/task/progress":
                if STATE["task"] and STATE["task"].get("status") == "Active":
                    delta = max(1, min(25, int(data.get("delta", 7))))
                    advance_task(delta)
                return self._json({"ok": bool(STATE["task"]), "state": STATE})

            if path == "/api/task/reset":
                STATE["task"] = None
                for w in STATE["workers"]:
                    w["decision"] = "Waiting"
                    w["progress"] = 0
                    w["assignment"] = None
                log_event("Active task cleared.")
                return self._json({"ok": True, "state": STATE})

            if path == "/api/session/reset":
                STATE["session"] = None
                STATE["workers"] = []
                STATE["task"] = None
                STATE["events"] = []
                STATE["notifications"] = []
                STATE["notificationSeq"] = 0
                return self._json({"ok": True, "state": STATE})

        return self._json({"ok": False, "error": "Unknown endpoint"}, 404)

if __name__ == "__main__":
    ip = lan_ip()
    threading.Thread(target=progress_engine, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"SwarmOS iQOO Hackathon Demo running at http://localhost:{PORT}")
    print(f"Same Wi-Fi receiver URL: http://{ip}:{PORT}")
    print("Keep this terminal open while sender and receiver devices are connected.")
    server.serve_forever()
