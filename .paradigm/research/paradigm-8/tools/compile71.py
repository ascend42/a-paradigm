#!/usr/bin/env python3
"""Checker implementing gnomon.md §7.1 rules 1-7 (incl. the suffixed-range rule) to produce Appendix A."""
import re, sys

path = sys.argv[1]
lines = open(path, encoding='utf-8').read().split('\n')

HEAD = re.compile(r'^(#{1,6})\s+(.*?)\s*$')
NUM = re.compile(r'^((?:\d+|[A-Z])(?:\.\d+)*)\.?(?=\s)')
SPAN = re.compile(r'`([^`\n]+)`')
NODE = re.compile(r'^[#$^!~][a-z][a-z0-9-]*$')
RANGE = re.compile(r'\b(G-[A-Z]{2,4})-(\d{2})([a-z]?)\.\.(\d{2})([a-z]?)\b')
TID = re.compile(r'\bG-[A-Z]{2,4}-\d{2}[a-z]?\b')

# pass 0: segment into sections with skip handling
sections = []  # dict(id, level, heading_nodes, lines:[(text,is_table)], order)
cur = {'id': 'preamble', 'level': 0, 'heading': '', 'body': []}
sections.append(cur)
skip_level = None
in_fence = False
refusals = []
for ln in lines:
    if ln.startswith('```'):
        in_fence = not in_fence
        continue
    if in_fence:
        continue
    m = HEAD.match(ln)
    if m:
        level = len(m.group(1)); title = m.group(2)
        if skip_level is not None and level <= skip_level:
            skip_level = None
        if title.endswith('(compile: skip)'):
            skip_level = level
            continue
        if skip_level is not None:
            continue
        nm = NUM.match(title)
        if nm:
            cur = {'id': nm.group(1), 'level': level, 'heading': title, 'body': []}
            sections.append(cur)
        # unnumbered heading: section unchanged; still scan its text as prose
        else:
            cur['body'].append((title, False))
        continue
    if skip_level is not None:
        continue
    is_table = ln.lstrip().startswith('|')
    if is_table and re.match(r'^\s*\|[\s:|-]+\|\s*$', ln):
        continue  # separator row
    cur['body'].append((ln, is_table))

def spans_nodes(text):
    return [s for s in SPAN.findall(text) if NODE.match(s)]

def ids_in(text):
    out = []
    def rep(m):
        pre, a, sa, b, sb = m.groups()
        if sa != sb:
            refusals.append(f'range suffix mismatch: {m.group(0)}')
        for n in range(int(a), int(b) + 1):
            out.append(f'{pre}-{n:02d}{sa}')
        return ' '
    text = RANGE.sub(rep, text)
    out.extend(TID.findall(text))
    return out

# nodes: first appearance
nodes = {}  # ref -> dict(kind, section)
order = []
KIND = {'#': 'symbol', '$': 'flow', '^': 'gate', '!': 'signal', '~': 'aspect'}
sec_nodes = {}  # section id -> set of node spans mentioned in heading+body
sec_head_nodes = {}
sec_index = {}
deliverable = None; deliverable_sec = None
for s in sections:
    sid = s['id']
    hn = set(spans_nodes(s['heading']))
    allnodes = set(hn)
    for text, _ in s['body']:
        allnodes.update(spans_nodes(text))
        dm = re.search(r'Deliverable:\s+([a-z][a-z0-9-]*)', text)
        if dm:
            if deliverable and deliverable != dm.group(1):
                refusals.append('multiple Deliverable lines')
            deliverable = dm.group(1); deliverable_sec = sid
    # first appearance in document order: heading first then body
    for sp in spans_nodes(s['heading']):
        if sp not in nodes:
            nodes[sp] = {'kind': KIND[sp[0]], 'section': sid}; order.append(sp)
    for text, _ in s['body']:
        for sp in spans_nodes(text):
            if sp not in nodes:
                nodes[sp] = {'kind': KIND[sp[0]], 'section': sid}; order.append(sp)
    sec_nodes[sid] = allnodes
    sec_head_nodes[sid] = hn
    sec_index[sid] = s

def ancestors(sid):
    if sid == 'preamble':
        return []
    parts = sid.split('.')
    out = []
    while len(parts) > 1:
        parts = parts[:-1]
        out.append('.'.join(parts))
    return out

def ancestor_targets(sid):
    for a in ancestors(sid):
        if a in sec_nodes and sec_nodes[a]:
            return set(sec_nodes[a])
    return None

bind = {sp: set() for sp in nodes}
orphan = set()
for s in sections:
    sid = s['id']
    for text, is_table in s['body']:
        ids = ids_in(text)
        if not ids:
            continue
        if is_table:
            targets = set(spans_nodes(text)) | sec_head_nodes[sid]
            if not targets:
                targets = ancestor_targets(sid)
        else:
            targets = set(sec_nodes[sid])
            if not targets:
                targets = ancestor_targets(sid)
        if not targets:
            orphan.update(ids)
        else:
            for t in targets:
                bind[t].update(ids)

def sortkey(i):
    m = re.match(r'(G-[A-Z]+)-(\d+)([a-z]?)', i)
    return (m.group(1), int(m.group(2)), m.group(3))

def refkey(sp):
    return 'sym:' + sp

print(f'nodes: {len(nodes)} symbol/flow/gate/aspect/signal + 1 doc = {len(nodes)+1}')
if refusals:
    print('REFUSALS:', refusals)
unoracled = [sp for sp in nodes if not bind[sp]]
print('unoracled:', unoracled)
print()
print('| ref | kind | section | test oracles |')
print('|---|---|---|---|')
for sp in sorted(nodes, key=lambda x: refkey(x).encode()):
    print(f"| `{refkey(sp)}` | {nodes[sp]['kind']} | {nodes[sp]['section']} | {', '.join(sorted(bind[sp], key=sortkey))} |")
oids = sorted(orphan, key=sortkey)
print(f"| `doc:{deliverable}` | doc | {deliverable_sec} | `orphanTests` ({len(oids)}): {', '.join(oids)} |")
