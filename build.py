#!/usr/bin/env python3
"""python3 build.py —— 把 src/ 拼成 public/index.html（Netlify 发布它），并输出 dist/artifact.html（发布成 claude.ai artifact 用）"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent
src = ROOT / 'src'
markup = (src / 'markup.html').read_text(encoding='utf-8')
parts = {k: (src / f).read_text(encoding='utf-8') for k, f in (('STYLE', 'style.css'), ('CONTENT', 'content.js'), ('APP', 'app.js'))}
for k in ('CONTENT', 'APP'):
    if '</script' in parts[k].lower():
        sys.exit(k + ' 里出现了 </script，会截断内联脚本')
page = markup
for k, v in parts.items():
    page = page.replace('/*__' + k + '__*/', v)
head = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="扑通：一个超拟人、高情感、有记忆的 AI 外星人伙伴">'
        '<meta name="theme-color" content="#86b3df">'
        '<link rel="manifest" href="/manifest.webmanifest">'
        '<link rel="icon" href="/icon.svg" type="image/svg+xml">'
        '<link rel="apple-touch-icon" href="/icon-mask.svg">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
        '</head><body>')
(ROOT / 'public').mkdir(exist_ok=True)
(ROOT / 'public' / 'index.html').write_text(head + page + '</body></html>', encoding='utf-8')
(ROOT / 'dist').mkdir(exist_ok=True)
(ROOT / 'dist' / 'artifact.html').write_text(page, encoding='utf-8')
print('public/index.html 和 dist/artifact.html 已生成')
