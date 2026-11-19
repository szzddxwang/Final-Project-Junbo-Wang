# Final Project Junbo Wang

MicroExplore is a website for learning microelectronics. Students can read articles, follow project guides, run circuit simulations and save their work. The website is built with Mendix. Python provides diagnosis, virtual experiments and Arduino compilation.

## What is in this repository?

| Folder | Contents |
| --- | --- |
| `mendix/` | Website pages, application model, Java actions, widgets and public learning materials |
| `backend/` | Python services, the current V15 diagnosis algorithm, model files and compiler tools |
| `workbench/` | Circuit interface source and browser bundles |
| `setup/` | Programs used to prepare and start the local application |

The application starts with a new local database. User accounts and private records from the online website are not included. Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 1. Download the project

On this GitHub page, click **Code → Download ZIP**. Extract the complete ZIP into a short folder, such as `H:\MicroExplore`.

All commands below use this folder. Replace the drive and folder if yours are different. Keep all files together, including `mendix/mprcontents/` and the compressed files in `backend/assets/`.

## 2. Install the software

Use a Windows computer with an x86_64 processor. Install [Mendix Studio Pro 11.14.0](https://marketplace.mendix.com/link/studiopro/). Allow its installer to install the required build components.

The Python service and compiler run in **Ubuntu 22.04 on WSL 2**. WSL lets Linux programs run on Windows. If it is not installed, follow the [Microsoft WSL installation instructions](https://learn.microsoft.com/en-us/windows/wsl/install). In an administrator PowerShell window, the installation command is:

```powershell
wsl --install -d Ubuntu-22.04
```

Restart Windows if requested. Open Ubuntu 22.04 and complete its username and password setup. Use `wsl -l -v` in PowerShell to check that Ubuntu uses version **2**.

Ubuntu 22.04 uses Python 3.10. In Ubuntu, install its virtual environment package if needed:

```sh
sudo apt update
sudo apt install python3-venv
```

Allow several GB of free space. Initial installation needs an Internet connection. A GPU and an Azure account are not required.

## 3. Prepare the backend

Open Ubuntu 22.04. Enter the extracted project folder and run these commands in order:

```sh
cd /mnt/h/MicroExplore
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install torch==2.12.0+cpu --index-url https://download.pytorch.org/whl/cpu
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python setup/restore_assets.py
backend/.venv/bin/python setup/init_local.py
backend/.venv/bin/python setup/setup_compiler.py
```

`/mnt/h/MicroExplore` is the Ubuntu path for `H:\MicroExplore`. For a folder on C, use `/mnt/c/` instead.

These commands install Python dependencies, restore the model files and prepare the Arduino compiler. They also create a local compilation credential and an application encryption key. The compiler setup can take several minutes. Wait for **Pinned Arduino compiler and isolated user-namespace execution are ready**. If a command fails, resolve that error before continuing. The compiler requires working Linux user namespaces; do not disable its isolation check.

Start the backend:

```sh
backend/.venv/bin/python setup/start_backend.py
```

Leave this Ubuntu terminal open. In a Windows browser, open `http://127.0.0.1:8000/health`. Check for `"status":"ok"` and `"model_ready":true`.

If port 8000 is already in use, start this copy on port 18080 instead:

```sh
cd /mnt/h/MicroExplore/backend
.venv/bin/python -m uvicorn src.api:app --host 127.0.0.1 --port 18080 --workers 1
```

Then use port 18080 for the health check and the Mendix address in the next step.

## 4. Open and configure Mendix

Close any existing Studio Pro window normally. Open **Command Prompt** on Windows and run:

```bat
cd /d H:\MicroExplore
setup\Open-Mendix.cmd "H:\11.14.0\modeler\studiopro.exe"
```

Replace the executable path with your Studio Pro installation path. This launcher opens `mendix\final project.mpr` and tells Mendix where to find the local compiler. Use it whenever opening this project. If your Ubuntu distribution has another name, add that name as a second argument.

In Studio Pro, open **App Explorer → App → Settings → Configurations**. Edit **Default**, then open **Constants**:

| Constant | Value |
| --- | --- |
| `MyFirstModule.DiagnosisAPIBaseURL` | `http://127.0.0.1:8000` or the port chosen above |
| `Encryption.EncryptionKey` | The 32 characters in `backend/config/application_encryption.key` |

Open the key file in Notepad and copy the characters without the line break. Use **New** if a constant is not listed. Save the configuration. Leaving the encryption key empty causes error **CE7159**. Keep this generated key with your local data; do not upload it to GitHub.

Next, open **App Explorer → App → Security → Administrator**. Set your own password for **MxAdmin** and save. Keep demo users disabled.

Click **Run locally**. Wait until the application has started, then click **View App**. The website normally opens at **http://localhost:8080/**. Sign in as MxAdmin with the password you just set.

## 5. Add the learning content

The new database is empty, so some lists initially show **No items found**.

While signed in as MxAdmin, open **Admin → Review Queue**. Expand **Catalog maintenance — separate from contribution review**. Click **Add curated courses, books & practical projects**. This adds the supplied public learning records without replacing existing records.

Return to Home. The resource cards should now appear. Open a topic or article to check its content. Some original articles and videos remain on their providers' websites and need an Internet connection.

## 6. Create a student account and use the website

Sign out. On the sign-in page, click **Create an account**. Register a student account with a password of at least eight characters, then sign in.

Use this student account for diagnosis and personal learning records. MxAdmin is the installation administrator and has no student profile, so it cannot create a learner diagnosis.

To use the circuit function, open **Practice → Circuit Workbench**. Choose an example, load it and click **Compile & Run**. Keep both the Mendix application and Python backend running. Use the website's save buttons to keep projects, captures and notes.

## 7. Stop and open it again

Click **Stop** in Studio Pro. Press **Ctrl+C** in the Ubuntu terminal to stop the backend.

Next time, start the backend again. Open Mendix with `setup\Open-Mendix.cmd`, then click **Run locally**. Dependency installation and content import are only needed for the initial setup.

Keep `mendix/deployment/data/` and `backend/config/application_encryption.key` to retain your local records. These files stay on your computer and should not be uploaded. Running this local copy does not change the online website.
