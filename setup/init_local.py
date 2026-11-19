"""Create new local service configuration without copying any live credential."""
from pathlib import Path
import secrets
ROOT=Path(__file__).resolve().parents[1]/'backend'
config=ROOT/'config';config.mkdir(exist_ok=True)
token=config/'programmable_worker.token'
if not token.exists():token.write_text(secrets.token_hex(32)+'\n',encoding='ascii')
if len(token.read_text(encoding='ascii').strip())!=64:raise SystemExit('Existing local worker token is invalid; inspect it before starting.')
(config/'research.enabled').write_text('Enabled for the locally authenticated educational Lab.\n',encoding='utf-8')
print('Local service configuration is ready. No token value is displayed.')
