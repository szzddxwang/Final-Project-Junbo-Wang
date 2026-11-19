"""Create new local service configuration without copying any live credential."""
from pathlib import Path
import secrets
ROOT=Path(__file__).resolve().parents[1]/'backend'
config=ROOT/'config';config.mkdir(exist_ok=True)
token=config/'programmable_worker.token'
if not token.exists():token.write_text(secrets.token_hex(32)+'\n',encoding='ascii')
if len(token.read_text(encoding='ascii').strip())!=64:raise SystemExit('Existing local worker token is invalid; inspect it before starting.')
key=config/'application_encryption.key'
if not key.exists():key.write_text(secrets.token_hex(16)+'\n',encoding='ascii')
if len(key.read_text(encoding='ascii').strip())!=32:raise SystemExit('Existing local application encryption key must contain exactly 32 characters; preserve it when retaining local data.')
(config/'research.enabled').write_text('Enabled for the locally authenticated educational Lab.\n',encoding='utf-8')
print('Local service configuration is ready. No credential value is displayed.')
print('Before the first Mendix run, set Encryption.EncryptionKey from backend/config/application_encryption.key in the active local configuration. Keep this file private and retain it with local data.')
