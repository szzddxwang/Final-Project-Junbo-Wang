# Final Project Junbo Wang

MicroExplore is a Mendix website for studying microelectronics. It combines a searchable reading library with learning checks, guided projects, an interactive circuit workbench and evidence-based troubleshooting. Learners can save their work. Administrators review submitted resources before public publication.

This is a clean local installation of the current application. It contains no accounts, private submissions, production database, cloud credentials or project history. The main diagnostic release is **V15**, `stable-xgboost-reliability-v15-4dc89df0adbc`. The former four-method comparison entry opens the current Circuit Diagnosis Simulator. The deployed website is unchanged by this public copy.

## What is included

| Folder | Purpose |
| --- | --- |
| `mendix/` | Studio Pro application model, Java actions, themes, required widgets and public teaching resources |
| `backend/src/` | FastAPI endpoints, V15 inference, virtual experiments and circuit execution support |
| `backend/research/` | Only numerical modules imported by the current parameter experiment; no benchmark runner |
| `backend/assets/` | Losslessly compressed model weights, required calibration data and pinned compiler archives |
| `backend/tools/programmable_simulator/` | Isolated compiler worker, allowlisted Wire library and tool notices |
| `workbench/` | Current widget bundles and editable circuit interface source |
| `setup/` | Asset restoration, fresh local configuration and launch/install helpers |

The `.mpr` is the application source model. It is not the user database. All `.mxunit` files in `mendix/mprcontents/` are required alongside it. Keep their binary contents unchanged.

## Requirements

The verified arrangement is **Windows with Mendix Studio Pro 11.14.0**, plus **Ubuntu 22.04 x86_64 in WSL 2** for Python and the isolated Arduino compiler. Use Python 3.10. Existing WSL must support unprivileged user namespaces. The compiler refuses to run if its isolation check fails.

Allow several GB of free disk space for model weights, Python and the compiler. A CPU is sufficient; a GPU is not required. Internet access is needed for the initial Python/Studio installation and externally hosted readings or videos. No Azure subscription or virtual machine is needed to run this copy locally.

Install Studio Pro from [Mendix](https://marketplace.mendix.com/link/studiopro/). If it requests its standard JDK or build components, use the components required by version 11.14.0. The project is a local source copy. Do not connect it to an existing production database.

## 1. Download the complete repository

Clone this repository or use GitHub **Code → Download ZIP**, then extract it into a short local path, for example `H:\MicroExplore`. The commands below assume that path. Adjust it if your location differs.

Do not open the ZIP directly in Studio Pro. All files, including `backend/assets/*.gzpart`, must be extracted. Git LFS is not required. Each asset part is below GitHub's individual file limit.

## 2. Prepare Python in WSL

Open Ubuntu 22.04 and move into the extracted directory:

```sh
cd /mnt/h/MicroExplore
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install torch==2.12.0+cpu --index-url https://download.pytorch.org/whl/cpu
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

If `venv` is unavailable, install the Ubuntu Python 3.10 virtual environment component using your normal administrator process. This repository does not change system security settings or configure a public server.

Use the Python executable as shown rather than a console script. This also works when the checkout path contains spaces.

## 3. Restore the runtime assets

```sh
backend/.venv/bin/python setup/restore_assets.py
backend/.venv/bin/python setup/init_local.py
backend/.venv/bin/python setup/setup_compiler.py
```

Restoration verifies each compressed part and every restored file with SHA-256. It reconstructs the exact V15 artifact, whose SHA-256 is:

```text
4dc89df0adbcc92eeab5b8440575b383a31ceb51a364d4801289224118ad92dc
```

`init_local.py` generates a new private compilation credential and a separate 32-character application encryption key on this computer. It preserves both files on subsequent runs. They are never committed. The Java actions and backend use the same compilation credential file. The encryption key is configured in Studio Pro as described below. Do not copy either credential from the deployed website.

`setup_compiler.py` installs the included pinned Arduino CLI 1.2.2, AVR core 1.8.6 and toolchain into this checkout. It extracts Bubblewrap locally and verifies an unprivileged, isolated process. It does not need `sudo`. The installer can take several minutes, especially on a Windows-mounted drive. A successful check prints user/group 65534 and the readiness message. If the isolation check fails, stop and use a compatible WSL/Linux environment; do not disable isolation.

## 4. Start the Python backend

In WSL, from the repository root:

```sh
backend/.venv/bin/python setup/start_backend.py
```

Leave that terminal open. Visit `http://127.0.0.1:8000/health` from Windows. The response should contain `"status":"ok"` and `"model_ready":true`. Startup preloads the required models and can take a little time. `http://127.0.0.1:8000/metadata/model` should identify V15.

The backend binds only to loopback. It is intended for this local application. Do not expose it directly to the Internet.

## 5. Open the Mendix application

Close any existing Studio Pro window normally. In Windows Command Prompt, run the supplied launcher with the actual location of Studio Pro:

```bat
cd /d H:\MicroExplore
setup\Open-Mendix.cmd "H:\11.14.0\modeler\studiopro.exe"
```

If your WSL distribution has a different name, add its quoted name as the second argument, for example `setup\Open-Mendix.cmd "H:\11.14.0\modeler\studiopro.exe" "YourDistributionName"`. The launcher sets `MICROEXPLORE_BACKEND_ROOT` for this Studio process so Java can find the new credential. It sets `MICROEXPLORE_WSL_DISTRO` for the compiler. These are process settings; they do not change your network or system-wide environment. The launcher does not use PowerShell scripts and does not require changing PowerShell execution policy.

The public source's `DiagnosisAPIBaseURL` constant already defaults to `http://127.0.0.1:8000`. Keep this value for local operation. Do not enter the production cloud backend address or credentials. If Studio Pro was opened before the launcher, close it normally and launch again so the process receives the settings.

## 6. Initialize your own local administrator

Before the first run, open **App Explorer → App → Settings → Configurations**. Edit the active local configuration, normally **Default**, and open **Constants**. Set the required private constant **Encryption.EncryptionKey** to the 32 characters in `backend/config/application_encryption.key`. Copy only the key, without its line break, and save. If the constant is not listed, use **New** to select it. An unset value produces Mendix error **CE7159**. This key belongs only to this new local installation. Keep it with your local data backup; replacing it can make existing encrypted values unreadable. Do not commit the generated file or a local configuration containing the key.

Then open **App Explorer → App → Security → Administrator** in Studio Pro. Set a new password for your local `MxAdmin` account and save it yourself. The public model contains randomized bootstrap values, not a shared working administrator password. Demo users remain disabled and the production security level is retained.

Click **Run locally**, wait for successful startup, then **View App**. The normal local website is `http://localhost:8080/`. Sign in with your newly configured local administrator. This account exists only in the new local database. It has no relationship to the cloud accounts.

## 7. Populate the public learning library

A new database initially has no content records. While signed in as Administrator, open the submission review administration page (`AdminSubmissionReview`) and click **Add curated courses, books & practical projects**. This invokes `MyFirstModule.SUB_Resource_ImportCourseCatalog`. The action imports the supplied public teaching catalog, courses, practical project guides and AI Applications reading catalog through the existing administrator permissions. It adds missing catalog records and preserves existing records. It does not import any private user data.

The base public teaching file is `mendix/resources/microexplore/public-teaching-catalog.json`. Source authors, licenses and external links are retained. Topic descriptions and the glossary also use the application's packaged catalogs. Some course videos and original articles remain hosted by their providers; they require an Internet connection.

After the import, return to Home and verify its four featured resources. Open Electronics Basics, Courses & Books and AI Applications, then open an article. Do not solve empty content by copying the author's database.

## 8. Create learner accounts and use the application

Use the existing **Create an account** registration link for a Learner account, or create one through account administration. Each person should have their own password. A learner can read, complete checks, use experiments, save projects and submit resources. Only administrators approve publication.

Open Circuit Workbench, load a supported example, and select **Compile & Run**. The browser sends a request through Mendix. The Python backend compiles the sketch in a worker with no network access and no host directory mounts. Firmware returns to the browser simulator. The application saves code, circuit connections and captures in the local Mendix database and file storage.

The supported board views are Uno R3, Nano, Pro Mini, Mega 2560 and Raspberry Pi Pico. Available peripherals and program support are bounded by the implemented teaching models. The Pico execution instruction budget can stop long or complex captures. An unsupported case must be reported as unsupported rather than treated as hardware-equivalent behavior.

The Circuit Diagnosis Simulator uses the current V15 evidence workflow. Its advanced parameter experiment remains a distinct simulated task. Other signal and sensor model assets support existing Lab functions; they are not selectable historical releases of the main six-system classifier. Some prior estimators are embedded inside the exact V15 artifact because the current release calls them internally.

## 9. Save, stop and reopen

Save work with the website's normal buttons. Stop the Mendix runtime using Studio Pro **Stop**. Stop the backend with Ctrl+C in its WSL terminal. To reopen, start the backend and use the launcher again. Keep the new `mendix/deployment/data/` directory and its files to preserve your local records. Never commit that directory or the generated credential.

The Azure VM used by the author's deployed website is separate. Starting this local copy does not start Azure or consume that VM's student credit. The public deployed website stores its records in Mendix Cloud. Your local copy stores its new records locally. Editing or running one does not automatically update the other.

## Verification and limits

This release was built successfully with Mendix 11.14.0, including model generation, widget packaging and Java compilation. Isolated tests passed for six-system diagnosis and four-capture V15 sessions, the existing Lab calculations and six-system advanced parameter sessions. Actual Uno and Mega compilation, Wire with multiple source files, invalid-source refusal, subsequent recovery, and refusal to read a host-only file were checked. Compilations reported network access disabled.

These checks are scoped to the supported application and synthetic inputs. They do not establish physical-hardware accuracy or prove every possible user program safe or correct. The V15 simulation evaluation still has unknown and mixed-fault acceptance errors. Use its uncertainty and review messages; do not interpret a high class score as proof that a physical circuit is fault-free.

The original cloud user acceptance evidence and historical experiment programs are intentionally not included in this runnable repository. No final-report draft, work logs, browser traces, model training datasets, backups or production user records are shipped.

## Source and third-party notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original licenses in the packaged tools, widgets and content remain applicable. This repository does not relicense third-party materials or the Mendix platform. It does not include a Mendix Studio Pro installer.
