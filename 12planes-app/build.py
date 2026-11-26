#!/usr/bin/env python3
"""Copy the map and Present from the Claude artifact sources into public/,
adding the data bridge and the app's own header links. Run before each deploy:
    python3 build.py /home/user/12planes
"""
import sys, shutil, pathlib

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../12planes')
pub = pathlib.Path(__file__).parent / 'public'
SHIM = '<script src="/claude-shim.js"></script>\n'

# map (the artifact page has no document wrapper of its own)
m = (src / 'index.html').read_text()
m = m.replace('<a href="present.html"', '<a href="/present.html"', 1)
m = m.replace('<div class="kpfoot">© Kontrapunkt</div>',
              '<div class="kpfoot">© Kontrapunkt · <a href="/admin.html" id="adminlink" hidden style="color:inherit">Manage access</a> · <a href="/auth/logout" style="color:inherit">Sign out</a></div>\n'
              '<script>fetch("/api/me").then(r=>r.json()).then(m=>{if(m.admin)document.getElementById("adminlink").hidden=false}).catch(()=>{})</script>', 1)
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + SHIM + '</head>\n<body>\n' + m + '\n</body>\n</html>\n')
(pub / 'index.html').write_text(page)

# present (already a full document)
p = (src / 'present.html').read_text()
p = p.replace('</head>', SHIM + '</head>', 1).replace('href="index.html', 'href="/index.html').replace('`index.html#', '`/index.html#')
(pub / 'present.html').write_text(p)

shutil.copy(src / 'strategy.json', pub / 'strategy.json')
(pub / 'img').mkdir(exist_ok=True)
for f in (src / 'img').glob('*.jpg'):
    shutil.copy(f, pub / 'img' / f.name)
print('built public/ from', src)
