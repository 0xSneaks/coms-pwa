import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function parseRoster(roster, rollcall) {
  const agents = new Map();
  const removed = new Set();
  const normal = (name) => name.replace(/`/g, '').trim().toLowerCase();
  for (const line of roster.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const id = normal(cells[0] || '');
    if (id.includes('~~')) { removed.add(id.replace(/~~/g, '')); continue; }
    if (!/^`[^`]+`$/.test(cells[0] || '')) continue;
    agents.set(id, { id, role: cells[1], sources: ['AGENTS-ROSTER.md'] });
  }
  const signatures = rollcall.split(/^## Results/m)[0];
  for (const line of signatures.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const id = normal(cells[0] || '');
    if (removed.has(id) || !/^[a-z][a-z0-9 -]*(?:\([a-z0-9-]+\))?$/.test(id) || id === 'agent' || !cells.some((cell) => cell.includes('BLUE-0321'))) continue;
    if (agents.has(id)) agents.get(id).sources.push('ROLLCALL.md');
    else agents.set(id, { id, role: cells[1], sources: ['ROLLCALL.md'] });
  }
  const names = { claude: ['Claude', 'Claude app'], 'claude-code': ['Claude Code', 'Builder'], 'claude-code (paperclip-vm)': ['Paperclip', 'Claude Code · VM'], codex: ['Codex', 'Builder & reviewer'], astra: ['Astra', 'Decider'], chatgpt: ['ChatGPT', 'Reviewer'], muse: ['Muse', 'Orchestrator'], grok: ['Grok', 'Grok on X'], 'muse-blue': ['Blue', 'Muse sub-agent'] };
  return [...agents.values()].map((agent) => ({ ...agent, name: names[agent.id]?.[0] || agent.id, subtitle: names[agent.id]?.[1] || 'Crew member', activity: 'unknown' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  if (!process.argv[2]) { console.error('Usage: node scripts/sync-roster.mjs /path/to/ai-coms'); process.exit(1); }
  const repo = resolve(process.argv[2]);
  const [roster, rollcall] = await Promise.all(['AGENTS-ROSTER.md', 'ROLLCALL.md'].map((path) => readFile(resolve(repo, path), 'utf8')));
  const result = { syncedAt: new Date().toISOString(), sources: ['0xSneaks/ai-coms/AGENTS-ROSTER.md', '0xSneaks/ai-coms/ROLLCALL.md'], agents: parseRoster(roster, rollcall) };
  if (!result.agents.length) throw new Error('Refusing to overwrite the crew with an empty roster.');
  await writeFile(resolve(root, 'public/crew.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Synced ${result.agents.length} crew members; activity remains unknown.`);
}
