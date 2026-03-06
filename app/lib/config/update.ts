import { Hono } from 'hono';
import { execa } from 'execa';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

const updateRouter = new Hono();

async function getLocalVersion() {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version;
  } catch (e) {
    console.error('Failed to read local version', e);
    return '0.0.0';
  }
}

async function getRemoteVersion() {
  try {
    await execa('git', ['fetch', 'origin', 'main']);
    const { stdout } = await execa('git', ['show', 'origin/main:package.json']);
    const pkg = JSON.parse(stdout);
    return pkg.version;
  } catch (e) {
    console.error('Failed to get remote version', e);
    return null;
  }
}

function compareVersions(v1: string, v2: string) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

updateRouter.get('/version', async (c) => {
  const localVersion = await getLocalVersion();
  const remoteVersion = await getRemoteVersion();
  
  const hasUpdate = remoteVersion ? compareVersions(remoteVersion, localVersion) > 0 : false;
  
  return c.json({
    localVersion,
    remoteVersion,
    hasUpdate
  });
});

updateRouter.post('/pull', async (c) => {
  try {
    console.log('Starting update process...');
    await execa('git', ['reset', '--hard', 'HEAD']);
    await execa('git', ['clean', '-fd']);
    await execa('git', ['pull', 'origin', 'main']);
    console.log('Git pull finished. Installing dependencies...');
    await execa('npm', ['install']);
    console.log('Dependencies installed. Triggering restart...');

    setTimeout(() => {
      const startScript = join(process.cwd(), 'restart.sh');
      const child = spawn('bash', [startScript], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();
    }, 1000);

    return c.json({ success: true, message: 'Updated successfully. Restarting...' });
  } catch (e) {
    console.error('Update failed', e);
    return c.json({ success: false, message: 'Update failed: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});

export { updateRouter };
