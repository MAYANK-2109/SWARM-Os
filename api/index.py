import json
import os
import random
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

STATE_FILE = "/tmp/swarmos_state.json"

DEFAULT_STATE = {
    "session": None,
    "workers": [],
    "task": None,
    "events": [],
    "notifications": [],
    "notificationSeq": 0,
    "last_tick": 0,
}

def now_text():
    return time.strftime("%H:%M:%S")

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT_STATE))

def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass

def notify(state, target, title, message, kind="info"):
    state["notificationSeq"] += 1
    state["notifications"].append({
        "id": state["notificationSeq"],
        "target": target,
        "title": title,
        "message": message,
        "kind": kind,
        "time": now_text(),
    })
    state["notifications"] = state["notifications"][-80:]

def log_event(state, message):
    state["events"].insert(0, {"time": now_text(), "message": message})
    del state["events"][30:]

def find_worker(state, name):
    return next((w for w in state["workers"] if w["name"] == name), None)

def assignment_for_index(task, idx, worker_name=""):
    allocations = task.get("allocations") or []
    if not allocations:
        return {
            "range": task.get("range", "Assigned chunk"),
            "requiredData": task.get("requiredData", "Task-specific subset"),
            "reason": "Compatible worker",
        }
    wn = worker_name.strip().lower()
    for alloc in allocations:
        if alloc.get("device", "").strip().lower() == wn:
            return alloc
    pos = min(idx + 1, len(allocations) - 1)
    return allocations[pos]

def maybe_auto_start(state):
    task = state.get("task")
    if not task or task.get("status") != "Awaiting approval":
        return False
    requested = [w for w in state["workers"] if w.get("assignment") is not None]
    if not requested or any(w.get("decision") == "Waiting" for w in requested):
        return False
    accepted = [w for w in requested if w.get("decision") == "Accepted"]
    if not accepted:
        task["status"] = "No workers accepted"
        task["stage"] = "Request closed"
        notify(state, "owner", "No receiver accepted", "The request ended without an accepted worker. Owner can run locally or resend.", "warning")
        log_event(state, "Approval round ended with no accepted receivers.")
        return False
    task["status"] = "Active"
    task["stage"] = "Transfer assigned data"
    task["progress"] = max(5, task.get("progress", 0))
    task["ownerProgress"] = max(5, task.get("ownerProgress", 0))
    task["autoStartedAt"] = now_text()
    log_event(state, f"All requested devices responded. Execution auto-started with {len(accepted)} accepted receiver(s).")
    notify(state, "owner", "Execution started automatically", f"{len(accepted)} accepted receiver(s) are now processing their assigned work.", "success")
    for w in accepted:
        w["status"] = "Working"
        notify(state, w["name"], "Execution started automatically", f"Your assigned {task['name']} work is now running.", "task")
    return True

def advance_task(state, delta=4):
    task = state.get("task")
    if not task or task.get("status") != "Active":
        return
    accepted = [w for w in state["workers"] if w.get("decision") == "Accepted"]
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
            notify(state, w["name"], "Assigned work completed", "Result returned to the owner. Temporary task data can now be cleared.", "success")
        log_event(state, "Task completed and results merged.")
        notify(state, "owner", "Task completed", f"{task['name']} finished and results were merged.", "success")

def tick_state(state):
    task = state.get("task")
    if task and task.get("status") == "Active":
        now = time.time()
        last_tick = state.get("last_tick", 0)
        if not last_tick:
            state["last_tick"] = now
            return
        elapsed = now - last_tick
        if elapsed >= 0.85:
            ticks = int(elapsed / 0.85)
            state["last_tick"] = last_tick + (ticks * 0.85)
            advance_task(state, delta=4 * ticks)

class handler(BaseHTTPRequestHandler):
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
        state = load_state()
        tick_state(state)
        save_state(state)

        if path == "/api/state":
            # Strip last_tick before sending to client for clean API state
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json(clean_state)

        if path == "/api/info":
            host = self.headers.get("host", "vercel.app")
            protocol = "https" if "localhost" not in host else "http"
            url = f"{protocol}://{host}"
            return self._json({
                "port": 443,
                "lanIp": host,
                "lanUrl": url,
                "localUrl": url
            })

        return self._json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._body()
        state = load_state()
        tick_state(state)

        if path == "/api/session/create":
            code = f"SWARM-{random.randint(1000,9999)}"
            state["session"] = {
                "code": code,
                "owner": data.get("owner", "HP Victus 16"),
                "status": "Open",
                "createdAt": now_text(),
            }
            state["workers"] = []
            state["task"] = None
            state["events"] = []
            state["notifications"] = []
            state["notificationSeq"] = 0
            state["last_tick"] = time.time()
            log_event(state, f"Session {code} created by {state['session']['owner']}.")
            notify(state, "owner", "Swarm session ready", f"Invite workers with code {code}.", "success")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/session/join":
            if not state["session"] or data.get("code", "").strip().upper() != state["session"]["code"]:
                return self._json({"ok": False, "error": "Join code not found."}, 404)
            name = (data.get("name") or "Worker Device").strip()
            existing = next((w for w in state["workers"] if w["name"].lower() == name.lower()), None)
            if not existing:
                worker = {
                    "id": f"w{len(state['workers'])+1}",
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
                state["workers"].append(worker)
                if state.get("task") and state["task"].get("status") in ("Awaiting approval", "Active"):
                    worker["decision"] = "Available"
                    worker["status"] = "Connected - available"
                    notify(state, "owner", "New device available", f"{name} joined after the current request. Resend before execution to include it in a fresh split.", "device")
                log_event(state, f"{name} joined the swarm.")
                notify(state, "owner", "New device connected", f"{name} joined and is visible in the live swarm.", "device")
                notify(state, name, "Connected to SwarmOS", f"Connected to {state['session']['owner']}. Wait for a task request.", "success")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/session/leave":
            name = data.get("name", "")
            before = len(state["workers"])
            state["workers"] = [w for w in state["workers"] if w["name"] != name]
            if len(state["workers"]) != before:
                log_event(state, f"{name} left the swarm.")
                notify(state, "owner", "Device disconnected", f"{name} left the session.", "warning")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/task/request":
            if not state["session"]:
                return self._json({"ok": False, "error": "Create a sender session first."}, 400)
            state["task"] = {
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
            for idx, worker in enumerate(state["workers"]):
                worker["decision"] = "Waiting"
                worker["progress"] = 0
                worker["assignment"] = assignment_for_index(state["task"], idx, worker["name"])
                assignment = worker["assignment"] or {}
                notify(
                    state,
                    worker["name"],
                    "New SwarmOS task request",
                    f"{state['task']['name']} • {assignment.get('range', 'Assigned chunk')} • Tap to review.",
                    "task"
                )
            log_event(state, f"Approval requests sent for {state['task']['name']}.")
            notify(state, "owner", "Requests sent", f"Task request sent to {len(state['workers'])} connected receiver(s).", "success")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/session/decision":
            name = data.get("name", "")
            decision = data.get("decision", "Waiting")
            worker = find_worker(state, name)
            if worker:
                worker["decision"] = decision
                worker["status"] = "Approved - waiting for peers" if decision == "Accepted" else "Connected"
                log_event(state, f"{name} {decision.lower()} the assigned task.")
                notify(state, "owner", f"{name}: {decision}", f"{name} {decision.lower()} the task request.", "success" if decision == "Accepted" else "warning")
                notify(state, name, f"Task {decision.lower()}", "Accepted. Work will start automatically when the approval round is complete." if decision == "Accepted" else "No task data will be transferred.", "success" if decision == "Accepted" else "warning")
                maybe_auto_start(state)
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": bool(worker), "state": clean_state})

        if path == "/api/task/start":
            if not state["task"]:
                return self._json({"ok": False, "error": "Send a task request first."}, 400)
            accepted = [w for w in state["workers"] if w["decision"] == "Accepted"]
            if not accepted:
                return self._json({"ok": False, "error": "At least one receiver must accept before starting."}, 400)
            state["task"]["status"] = "Active"
            state["task"]["stage"] = "Transfer assigned data"
            state["task"]["progress"] = max(5, state["task"].get("progress", 0))
            state["task"]["ownerProgress"] = max(5, state["task"].get("ownerProgress", 0))
            state["last_tick"] = time.time()
            log_event(state, f"Execution started with {len(accepted)} accepted worker(s).")
            notify(state, "owner", "Distributed execution started", f"{len(accepted)} receiver(s) are now processing assigned data.", "success")
            for w in accepted:
                w["status"] = "Working"
                notify(state, w["name"], "Execution started", f"SwarmOS started your assigned {state['task']['name']} chunk.", "task")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/task/progress":
            if state["task"] and state["task"].get("status") == "Active":
                delta = max(1, min(25, int(data.get("delta", 7))))
                advance_task(state, delta)
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": bool(state["task"]), "state": clean_state})

        if path == "/api/task/reset":
            state["task"] = None
            for w in state["workers"]:
                w["decision"] = "Waiting"
                w["progress"] = 0
                w["assignment"] = None
            log_event(state, "Active task cleared.")
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        if path == "/api/session/reset":
            state["session"] = None
            state["workers"] = []
            state["task"] = None
            state["events"] = []
            state["notifications"] = []
            state["notificationSeq"] = 0
            save_state(state)
            clean_state = {k: v for k, v in state.items() if k != "last_tick"}
            return self._json({"ok": True, "state": clean_state})

        return self._json({"ok": False, "error": "Unknown endpoint"}, 404)
