/**
 * Git Management Router
 *
 * Provides 8 endpoints for full Git management from the browser:
 * status, branches, log, diff, stage, unstage, commit, push.
 */

import { Router, type Request, type Response } from 'express';
import simpleGit, { type SimpleGit } from 'simple-git';

const SYMBOL_RE = /[#$^!~][\w-]+/g;

function extractSymbols(text: string): string[] {
  const matches = text.match(SYMBOL_RE);
  return matches ? [...new Set(matches)] : [];
}

export function createGitRouter(projectDir: string): Router {
  const router = Router();
  const git: SimpleGit = simpleGit(projectDir);

  // GET /api/git/status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const [status, branchInfo] = await Promise.all([
        git.status(),
        git.branch(),
      ]);

      res.json({
        branch: branchInfo.current,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        unstaged: status.modified.filter(f => !status.staged.includes(f)),
        untracked: status.not_added,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get git status', detail: String(err) });
    }
  });

  // GET /api/git/branches
  router.get('/branches', async (_req: Request, res: Response) => {
    try {
      const branchInfo = await git.branch();
      const branches = Object.values(branchInfo.branches).map(b => ({
        name: b.name,
        current: b.current,
        commit: b.commit,
        label: b.label,
      }));
      res.json({ current: branchInfo.current, branches });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get branches', detail: String(err) });
    }
  });

  // GET /api/git/log?limit=20&offset=0
  router.get('/log', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      // simple-git doesn't support offset directly, use --skip
      const log = await git.log({
        maxCount: limit,
        '--skip': offset,
      } as any);

      const commits = log.all.map(c => ({
        hash: c.hash,
        shortHash: c.hash.substring(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date,
        symbols: extractSymbols(c.message),
      }));

      res.json({ commits, total: log.total });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get git log', detail: String(err) });
    }
  });

  // GET /api/git/diff?path=...&staged=bool
  router.get('/diff', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string;
      const staged = req.query.staged === 'true';

      const args: string[] = [];
      if (staged) args.push('--cached');
      if (filePath) args.push('--', filePath);

      const diffText = await git.diff(args);
      res.json({ diff: diffText });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get diff', detail: String(err) });
    }
  });

  // POST /api/git/stage { paths: string[] }
  router.post('/stage', async (req: Request, res: Response) => {
    try {
      const { paths } = req.body as { paths: string[] };
      if (!paths?.length) {
        res.status(400).json({ error: 'paths is required' });
        return;
      }
      await git.add(paths);
      res.json({ staged: paths });
    } catch (err) {
      res.status(500).json({ error: 'Failed to stage files', detail: String(err) });
    }
  });

  // POST /api/git/unstage { paths: string[] }
  router.post('/unstage', async (req: Request, res: Response) => {
    try {
      const { paths } = req.body as { paths: string[] };
      if (!paths?.length) {
        res.status(400).json({ error: 'paths is required' });
        return;
      }
      await git.reset(['HEAD', '--', ...paths]);
      res.json({ unstaged: paths });
    } catch (err) {
      res.status(500).json({ error: 'Failed to unstage files', detail: String(err) });
    }
  });

  // POST /api/git/commit { message: string }
  router.post('/commit', async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message: string };
      if (!message?.trim()) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      const result = await git.commit(message);
      res.json({
        hash: result.commit,
        summary: result.summary,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to commit', detail: String(err) });
    }
  });

  // POST /api/git/push
  router.post('/push', async (_req: Request, res: Response) => {
    try {
      const result = await git.push();
      res.json({
        pushed: true,
        branch: result.branch,
        remoteMessages: result.remoteMessages,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to push', detail: String(err) });
    }
  });

  return router;
}
