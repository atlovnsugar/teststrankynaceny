from pathlib import Path
import ast, importlib.util
ROOT=Path(__file__).resolve().parents[1]
mod_path=ROOT/'scripts/refresh_energy_system.py'
spec=importlib.util.spec_from_file_location('energy_refresh',mod_path)
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
for p in [mod_path,ROOT/'scripts/validate_energy_system.py']:
    ast.parse(p.read_text(encoding='utf-8'))
    print('syntax ok:',p.name)
assert mod.classify_source('','Wind power')=='renewable'
assert mod.classify_source('','Natural gas')=='fossil'
assert mod.classify_source('','Nuclear heat')=='nuclear'
assert mod.europe_bbox_intersects((-5,40,10,60))
assert not mod.europe_bbox_intersects((70,10,90,20))
frontend=(ROOT/'site/energy_system.js').read_text(encoding='utf-8')
for token in ['aggregatedData','oilMode','renewable','fossil','infra-route']:
    assert token in frontend, token
for token in ['nrg_cb_pem','nrg_pc_204','GlobalEnergyMonitor']:
    assert token in mod_path.read_text(encoding='utf-8'), token
print('energy system frontend/backend contract ok')
