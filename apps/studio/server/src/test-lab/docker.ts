import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Only start/stop/inspect of the named container. Never rm, never touches the volume.

export const POSTGRES_CONTAINER = 'raptoru2-pg';

export type ContainerState = 'running' | 'stopped' | 'missing' | 'error';

async function docker(args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, {
    windowsHide: true,
    timeout,
  });
  return stdout.trim();
}

export async function containerState(
  name = POSTGRES_CONTAINER,
): Promise<{ state: ContainerState; detail: string }> {
  try {
    const status = await docker(
      ['inspect', '-f', '{{.State.Status}}', name],
      10_000,
    );
    return {
      state: status === 'running' ? 'running' : 'stopped',
      detail: status,
    };
  } catch (error) {
    const message =
      (error as { stderr?: string; message: string }).stderr ||
      (error as Error).message;
    if (/no such object/i.test(message))
      return { state: 'missing', detail: `container ${name} not found` };
    return {
      state: 'error',
      detail: message.trim().split('\n')[0] ?? 'docker unavailable',
    };
  }
}

export async function startContainer(name = POSTGRES_CONTAINER): Promise<void> {
  await docker(['start', name]);
}

export async function stopContainer(name = POSTGRES_CONTAINER): Promise<void> {
  await docker(['stop', name]);
}

/** True once Postgres inside the container accepts connections. */
export async function postgresReady(
  name = POSTGRES_CONTAINER,
): Promise<boolean> {
  try {
    await docker(['exec', name, 'pg_isready', '-q'], 10_000);
    return true;
  } catch {
    return false;
  }
}

export interface DockerOps {
  containerState: typeof containerState;
  startContainer: typeof startContainer;
  stopContainer: typeof stopContainer;
  postgresReady: typeof postgresReady;
}

export const dockerOps: DockerOps = {
  containerState,
  startContainer,
  stopContainer,
  postgresReady,
};
