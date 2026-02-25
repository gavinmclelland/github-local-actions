import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationTarget, workspace } from 'vscode';
import { Act } from './act';
import { WorkflowsManager } from './workflowsManager';

export enum Platform {
    windows = 'win32',
    mac = 'darwin',
    linux = 'linux'
}

export enum Section {
    actCommand = 'actCommand',
    workflowsDirectory = 'workflowsDirectory',
    dockerDesktopPath = 'dockerDesktopPath',
    containerRuntime = 'containerRuntime',
    limaSocketPath = 'limaSocketPath',
    colimaSocketPath = 'colimaSocketPath',
    lumeSocketPath = 'lumeSocketPath'
}

export type ContainerRuntime = 'docker' | 'podman' | 'lima' | 'colima' | 'lume';

export namespace ConfigurationManager {
    export const group: string = 'githubLocalActions';
    export const searchPrefix: string = '@ext:sanjulaganepola.github-local-actions';

    // Default socket paths for Lima, Colima, and Lume
    export const defaultLimaSocketPath = path.join(os.homedir(), '.lima/docker/sock/docker.sock');
    export const defaultColimaSocketPath = path.join(os.homedir(), '.colima/docker.sock');
    export const defaultLumeSocketPath = path.join(os.homedir(), '.lume/docker.sock');

    export async function initialize(): Promise<void> {
        let actCommand = ConfigurationManager.get<string>(Section.actCommand);
        if (!actCommand) {
            await ConfigurationManager.set(Section.actCommand, Act.defaultActCommand);
        }

        let workflowsDirectory = ConfigurationManager.get<string>(Section.workflowsDirectory);
        if (!workflowsDirectory) {
            await ConfigurationManager.set(Section.workflowsDirectory, WorkflowsManager.defaultWorkflowsDirectory);
        }

        let dockerDesktopPath = ConfigurationManager.get<string>(Section.dockerDesktopPath);
        if (!dockerDesktopPath) {
            switch (process.platform) {
                case Platform.windows:
                    dockerDesktopPath = 'C:/Program Files/Docker/Docker/Docker Desktop.exe';
                    break;
                case Platform.mac:
                    dockerDesktopPath = '/Applications/Docker.app';
                    break;
                default:
                    return;
            }

            await ConfigurationManager.set(Section.dockerDesktopPath, dockerDesktopPath);
        }

        // Initialize container runtime setting (default to docker)
        let containerRuntime = ConfigurationManager.get<ContainerRuntime>(Section.containerRuntime);
        if (!containerRuntime) {
            await ConfigurationManager.set(Section.containerRuntime, 'docker');
        }

        // Initialize Lima socket path if not set
        let limaSocketPath = ConfigurationManager.get<string>(Section.limaSocketPath);
        if (!limaSocketPath) {
            await ConfigurationManager.set(Section.limaSocketPath, ConfigurationManager.defaultLimaSocketPath);
        }

        // Initialize Colima socket path if not set
        let colimaSocketPath = ConfigurationManager.get<string>(Section.colimaSocketPath);
        if (!colimaSocketPath) {
            await ConfigurationManager.set(Section.colimaSocketPath, ConfigurationManager.defaultColimaSocketPath);
        }

        // Initialize Lume socket path if not set
        let lumeSocketPath = ConfigurationManager.get<string>(Section.lumeSocketPath);
        if (!lumeSocketPath) {
            await ConfigurationManager.set(Section.lumeSocketPath, ConfigurationManager.defaultLumeSocketPath);
        }
    }

    export function getSearchTerm(section: Section): string {
        return `${ConfigurationManager.searchPrefix} ${ConfigurationManager.group}.${section}`;
    }

    export function get<T>(section: Section): T | undefined {
        return workspace.getConfiguration(ConfigurationManager.group).get(section) as T;
    }

    export async function set(section: Section, value: any): Promise<void> {
        return await workspace.getConfiguration(ConfigurationManager.group).update(section, value, ConfigurationTarget.Global);
    }

    /**
     * Get the Docker socket path based on the selected container runtime.
     * Returns undefined for docker/podman as they use default system socket.
     */
    export function getContainerRuntimeSocket(): string | undefined {
        const runtime = ConfigurationManager.get<ContainerRuntime>(Section.containerRuntime);

        switch (runtime) {
            case 'lima':
                return ConfigurationManager.get<string>(Section.limaSocketPath);
            case 'colima':
                return ConfigurationManager.get<string>(Section.colimaSocketPath);
            case 'lume':
                return ConfigurationManager.get<string>(Section.lumeSocketPath);
            default:
                // docker and podman use the default socket
                return undefined;
        }
    }

    /**
     * Detect available container runtimes on the system.
     * Returns an array of available runtime names.
     */
    export async function detectAvailableRuntimes(): Promise<ContainerRuntime[]> {
        const availableRuntimes: ContainerRuntime[] = ['docker'];

        // Check for Lima
        try {
            await new Promise<void>((resolve, reject) => {
                childProcess.exec('limactl --version', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            availableRuntimes.push('lima');
        } catch { }

        // Check for Colima
        try {
            await new Promise<void>((resolve, reject) => {
                childProcess.exec('colima version', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            availableRuntimes.push('colima');
        } catch { }

        // Check for Podman
        try {
            await new Promise<void>((resolve, reject) => {
                childProcess.exec('podman --version', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            availableRuntimes.push('podman');
        } catch { }

        // Check for Lume
        try {
            await new Promise<void>((resolve, reject) => {
                childProcess.exec('lume --version', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            availableRuntimes.push('lume');
        } catch { }

        return availableRuntimes;
    }
}