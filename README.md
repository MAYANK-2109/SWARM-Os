# SwarmOS Advanced Color App v4

Interactive sender/receiver hackathon prototype with a colorful 3D dashboard, operation-specific integrations, real demo device profiles, resource-aware AI allocation, request alerts and a completion celebration.

## Run in VS Code

1. Open the `SwarmOS_Advanced_Color_App_v4` folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run:

```powershell
python server.py
```

4. Open `http://localhost:5173`.

For a second device on the same Wi-Fi, the terminal prints a LAN URL such as `http://192.168.x.x:5173`. Windows Firewall may ask for permission; allow private-network access if you want the phone/laptop receiver demo.

## Main demo flow

**Owner / Sender**

Dashboard → Create Task → choose operation → choose source/editor → set advanced options → select compute devices → inspect AI split → Sender Console → Create Session → invite receiver → Send Request + Alert Devices → Start Accepted Workers → Active Task → Run live progress simulation.

**Receiver**

Open Receiver Console → choose iQOO Z10 Turbo or ASUS TUF Gaming F15 → join session → receive large request alert → inspect assigned scope → Accept/Decline → watch progress → completion celebration.

## What is visible in Create Task

- **Video Export:** DaVinci Resolve (supported demo), Adobe Premiere Pro, Adobe Media Encoder, Final Cut Pro, CapCut Desktop, Generic Video/FFmpeg.
- **Software Testing:** Local Project Folder (supported demo), GitHub, GitLab, Bitbucket, Google Drive Project, ZIP Project.
- **Smart Transfer / Download:** Direct URL (supported demo), Google Drive, OneDrive, Dropbox, Amazon S3, private server, shared link.
- **Future operations:** Photo Intelligence, OCR/Search, AI Batch Inference, Media Transcode, Dataset Processing, Code Build/Compile, Batch Compression.

Future options are clickable roadmap previews but deliberately marked as not eligible for the current supported execution path.

## Demo device profiles

- HP Victus 16 — owner/worker
- ASUS TUF Gaming F15 — worker
- iQOO Z10 Turbo — mobile worker

The allocation preview uses CPU/GPU, RAM, load, network, battery, thermals and compatibility to produce a weighted split.


## V5 polish updates
- Clearer Create Task flow
- Sender join methods: code, link, owner ID, QR-style preview
- Approval radar keeps scanning until a receiver responds
- Receiver App ID and Device Token shown
- Bigger attractive request overlay
- Receiver contribution card shows exact share and assigned range
- Clear 1-2-3 path on receiver approval/execution

## V6 — clearer iQOO hackathon flow
- Connect receivers first; each new receiver animates into the Sender Console live swarm.
- Sender sends one work request; receiver gets a large 5-second request alert.
- Sender receives a 5-second Accepted/Declined popup for each response.
- No manual Start button in the main flow: once every requested receiver has responded and at least one accepts, execution starts automatically.
- Server auto-advances live progress, so sender and receiver panels update together without pressing a simulation button.
- Clear owner vs worker distribution table: share %, exact range, predicted finish target, status and progress.
- Live Swarm 3D-style mesh plus iQOO hackathon phone animation.
- Device/connector brand logos use Simple Icons CDN when online and clean initials as an offline fallback.


## V7 flow fixes
- cleaner sender flow
- discovery radar with no connected device state
- connect 2nd/3rd device prompts
- route animation for send/return/merge
- clearer owner vs worker contribution
- completed task panel with clear-next-task action
- 5-second request/accept overlays
