import * as childProcess from "child_process";
import { commands, env, extensions, QuickPickItemKind, ShellExecution, TaskGroup, TaskPanelKind, TaskRevealKind, tasks, TaskScope, ThemeIcon, Uri, window } from "vscode";
import { Act, Option } from "./act";
import { ConfigurationManager, Platform, Section } from "./configurationManager";
import { act, componentsTreeDataProvider } from "./extension";
import ComponentsTreeDataProvider from "./views/components/componentsTreeDataProvider";

export interface Component<T extends CliStatus | ExtensionStatus> {
    name: string,
    icon: string,
    version?: string,
    path?: string,
    status: T,
    required: boolean,
    information: string,
    installation: () => Promise<void>,
    start?: () => Promise<void>,
    fixPermissions?: () => Promise<void>,
    message?: string
}

export enum CliStatus {
    Installed = 'Installed',
    NotInstalled = 'Not Installed',
    Running = 'Running',
    NotRunning = 'Not Running',
    InvalidPermissions = 'Invalid Permissions'
}

export enum ExtensionStatus {
    Activated = 'Activated',
    NotActivated = 'Not Activated'
}

export class ComponentsManager {
    static actVersionRegExp: RegExp = /act version (.+)/;
    static dockerVersionRegExp: RegExp = /Docker Engine Version:\s(.+)/;
    static limaVersionRegExp: RegExp = /limactl version (.+)/;
    static colimaVersionRegExp: RegExp = /colima version (.+)/;
    static podmanVersionRegExp: RegExp = /podman version (.+)/;
    static lumeVersionRegExp: RegExp = /lume version (.+)/;

    async getComponents(): Promise<Component<CliStatus | ExtensionStatus>[]> {
        const components: Component<CliStatus | ExtensionStatus>[] = [];

        const actCliInfo = await this.getCliInfo(`${Act.getActCommand()} ${Option.Version}`, ComponentsManager.actVersionRegExp, false, false);
        components.push({
            name: 'nektos/act',
            icon: 'terminal',
            version: actCliInfo.version,
            status: actCliInfo.status,
            required: true,
            information: 'https://github.com/nektos/act',
            installation: async () => {
                const installationMethods: any[] = [
                    {
                        label: 'Software Package Managers',
                        kind: QuickPickItemKind.Separator
                    }
                ];

                Object.entries(act.installationCommands).map(([packageManager, command]) => {
                    installationMethods.push({
                        label: packageManager,
                        description: command,
                        iconPath: new ThemeIcon('terminal'),
                    });
                });

                installationMethods.push(
                    {
                        label: 'Pre-built Artifacts',
                        kind: QuickPickItemKind.Separator
                    },
                    {
                        label: 'Install Pre-built Executable',
                        description: 'Install pre-built executable',
                        iconPath: new ThemeIcon('package')
                    },
                    {
                        label: 'Bash Script Installation',
                        description: 'Install pre-built act executable using bash script',
                        iconPath: new ThemeIcon('code'),
                        link: 'https://nektosact.com/installation/index.html#bash-script'
                    },
                    {
                        label: 'Build From Source',
                        description: 'Build nektos/act yourself',
                        iconPath: new ThemeIcon('tools'),
                        link: 'https://nektosact.com/installation/index.html#build-from-source'
                    }
                );

                const selectedInstallationMethod = await window.showQuickPick(installationMethods, {
                    title: 'Select the method of installation',
                    placeHolder: 'Installation Method'
                });

                if (selectedInstallationMethod) {
                    if (selectedInstallationMethod.label === 'Install Pre-built Executable') {
                        const prebuiltExecutables = Object.entries(act.prebuiltExecutables).map(([architecture, link]) => {
                            return {
                                label: architecture,
                                iconPath: new ThemeIcon('package'),
                                link: link
                            };
                        });

                        const selectedPrebuiltExecutable = await window.showQuickPick(prebuiltExecutables, {
                            title: 'Select the prebuilt executable to download',
                            placeHolder: 'Prebuilt executable'
                        });

                        if (selectedPrebuiltExecutable) {
                            await env.openExternal(Uri.parse(selectedPrebuiltExecutable.link));
                            window.showInformationMessage('Unpack the executable and move it to your desired location. Once nektos/act is successfully installed, add it to your shell\'s PATH and then refresh the components view.', 'Refresh').then(async value => {
                                if (value === 'Refresh') {
                                    componentsTreeDataProvider.refresh();
                                }
                            });
                        }

                        act.updateActCommand(Act.defaultActCommand);
                    } else if (selectedInstallationMethod.link) {
                        await env.openExternal(Uri.parse(selectedInstallationMethod.link));
                        window.showInformationMessage('Once nektos/act is successfully installed, add it to your shell\'s PATH and then refresh the components view.', 'Refresh').then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            }
                        });

                        act.updateActCommand(Act.defaultActCommand);
                    } else {
                        await act.install(selectedInstallationMethod.label);
                    }
                }
            }
        });

        const dockerCliInfo = await this.getCliInfo(`docker version --format "Docker Engine Version: {{.Client.Version}}"`, ComponentsManager.dockerVersionRegExp, true, true);
        const dockerDesktopPath = ConfigurationManager.get<string>(Section.dockerDesktopPath);
        components.push({
            name: 'Docker Engine',
            icon: 'dashboard',
            version: dockerCliInfo.version,
            path: dockerDesktopPath,
            status: dockerCliInfo.status,
            required: true,
            information: 'https://docs.docker.com/engine',
            installation: async () => {
                await env.openExternal(Uri.parse('https://docs.docker.com/engine/install'));
            },
            start: async () => {
                const dockerDesktopPath = ConfigurationManager.get<string>(Section.dockerDesktopPath);
                if (dockerDesktopPath) {
                    await env.openExternal(Uri.parse(dockerDesktopPath));
                } else {
                    if (process.platform === Platform.linux) {
                        await tasks.executeTask({
                            name: 'Docker Engine',
                            detail: 'Start Docker Engine',
                            definition: {
                                type: 'Start Docker Engine'
                            },
                            source: 'GitHub Local Actions',
                            scope: TaskScope.Workspace,
                            isBackground: true,
                            presentationOptions: {
                                reveal: TaskRevealKind.Always,
                                focus: false,
                                clear: true,
                                close: false,
                                echo: true,
                                panel: TaskPanelKind.Shared,
                                showReuseMessage: false
                            },
                            problemMatchers: [],
                            runOptions: {},
                            group: TaskGroup.Build,
                            execution: new ShellExecution('systemctl start docker', { executable: env.shell })
                        });
                    } else {
                        window.showErrorMessage(`Invalid environment: ${process.platform}`, 'Report an Issue').then(async value => {
                            if (value === 'Report an Issue') {
                                await commands.executeCommand('githubLocalActions.reportAnIssue');
                            }
                        });
                        return;
                    }
                }

                window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                    // Delay 4 seconds for Docker Desktop to be started
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(4000);

                    // Check again for docker status
                    const newDockerCliInfo = await this.getCliInfo(`docker version --format "Docker Engine Version: {{.Client.Version}}"`, ComponentsManager.dockerVersionRegExp, true, true);
                    if (dockerCliInfo.status !== newDockerCliInfo.status) {
                        componentsTreeDataProvider.refresh();
                    } else {
                        const verificationMessage = process.platform === Platform.linux ?
                            'If it failed to start, start it manually.' :
                            'If it failed to start, configure your Docker Desktop path or start it manually.';
                        const options = process.platform === Platform.linux ?
                            ['Refresh'] :
                            ['Refresh', 'Configure Docker Desktop Path'];
                        window.showInformationMessage(`Once Docker Engine is successfully started, refresh the components view. ${verificationMessage}`, ...options).then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            } else if (value === 'Configure Docker Desktop Path') {
                                await commands.executeCommand('workbench.action.openSettings', ConfigurationManager.getSearchTerm(Section.dockerDesktopPath));
                            }
                        });
                    }
                });
            },
            fixPermissions: async () => {
                if (process.platform === Platform.linux) {
                    window.showInformationMessage('By default, the Docker daemon binds to a Unix socket owned by the root user. To manage Docker as a non-root user, a Unix group called "docker" should be created with your user added to it.', 'Proceed', 'Learn More').then(async value => {
                        if (value === 'Proceed') {
                            await tasks.executeTask({
                                name: 'Docker Engine',
                                detail: 'Fix Docker Engine Permissions',
                                definition: {
                                    type: 'Fix Docker Engine Permissions'
                                },
                                source: 'GitHub Local Actions',
                                scope: TaskScope.Workspace,
                                isBackground: true,
                                presentationOptions: {
                                    reveal: TaskRevealKind.Always,
                                    focus: false,
                                    clear: true,
                                    close: false,
                                    echo: true,
                                    panel: TaskPanelKind.Shared,
                                    showReuseMessage: false
                                },
                                problemMatchers: [],
                                runOptions: {},
                                group: TaskGroup.Build,
                                execution: new ShellExecution('sudo groupadd docker; sudo usermod -aG docker $USER')
                            });

                            window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                                // Delay 4 seconds for Docker to be started
                                const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                                await delay(4000);

                                // Check again for docker status
                                const newDockerCliInfo = await this.getCliInfo(`docker version --format "Docker Engine Version: {{.Client.Version}}"`, ComponentsManager.dockerVersionRegExp, true, true);
                                if (dockerCliInfo.status !== newDockerCliInfo.status) {
                                    componentsTreeDataProvider.refresh();
                                } else {
                                    window.showInformationMessage('You may need to restart your PC for these changes to take affect.');
                                }
                            });
                        } else if (value === 'Learn More') {
                            await env.openExternal(Uri.parse('https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user'));
                        }
                    });
                } else {
                    window.showErrorMessage(`Permissions cannot be automatically fixed for ${process.platform} environment.`);
                }
            }
        });

        // Detect Lima
        const limaCliInfo = await this.getCliInfo('limactl --version', ComponentsManager.limaVersionRegExp, true, true);
        const limaSocketPath = ConfigurationManager.get<string>(Section.limaSocketPath);
        components.push({
            name: 'Lima',
            icon: 'vm',
            version: limaCliInfo.version,
            path: limaSocketPath,
            status: limaCliInfo.status,
            required: false,
            information: 'https://github.com/lima-vm/lima',
            installation: async () => {
                await env.openExternal(Uri.parse('https://github.com/lima-vm/lima#installation'));
            },
            start: async () => {
                await tasks.executeTask({
                    name: 'Lima',
                    detail: 'Start Lima Docker VM',
                    definition: {
                        type: 'Start Lima Docker VM'
                    },
                    source: 'GitHub Local Actions',
                    scope: TaskScope.Workspace,
                    isBackground: true,
                    presentationOptions: {
                        reveal: TaskRevealKind.Always,
                        focus: false,
                        clear: true,
                        close: false,
                        echo: true,
                        panel: TaskPanelKind.Shared,
                        showReuseMessage: false
                    },
                    problemMatchers: [],
                    runOptions: {},
                    group: TaskGroup.Build,
                    execution: new ShellExecution('limactl start docker')
                });

                window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(4000);

                    const newLimaCliInfo = await this.getCliInfo('limactl --version', ComponentsManager.limaVersionRegExp, true, true);
                    if (limaCliInfo.status !== newLimaCliInfo.status) {
                        componentsTreeDataProvider.refresh();
                    } else {
                        window.showInformationMessage('Once Lima is successfully started, refresh the components view.', 'Refresh').then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            }
                        });
                    }
                });
            }
        });

        // Detect Colima
        const colimaCliInfo = await this.getCliInfo('colima version', ComponentsManager.colimaVersionRegExp, true, true);
        const colimaSocketPath = ConfigurationManager.get<string>(Section.colimaSocketPath);
        components.push({
            name: 'Colima',
            icon: 'vm',
            version: colimaCliInfo.version,
            path: colimaSocketPath,
            status: colimaCliInfo.status,
            required: false,
            information: 'https://github.com/abiosoft/colima',
            installation: async () => {
                await env.openExternal(Uri.parse('https://github.com/abiosoft/colima#installation'));
            },
            start: async () => {
                await tasks.executeTask({
                    name: 'Colima',
                    detail: 'Start Colima Docker VM',
                    definition: {
                        type: 'Start Colima Docker VM'
                    },
                    source: 'GitHub Local Actions',
                    scope: TaskScope.Workspace,
                    isBackground: true,
                    presentationOptions: {
                        reveal: TaskRevealKind.Always,
                        focus: false,
                        clear: true,
                        close: false,
                        echo: true,
                        panel: TaskPanelKind.Shared,
                        showReuseMessage: false
                    },
                    problemMatchers: [],
                    runOptions: {},
                    group: TaskGroup.Build,
                    execution: new ShellExecution('colima start')
                });

                window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(4000);

                    const newColimaCliInfo = await this.getCliInfo('colima version', ComponentsManager.colimaVersionRegExp, true, true);
                    if (colimaCliInfo.status !== newColimaCliInfo.status) {
                        componentsTreeDataProvider.refresh();
                    } else {
                        window.showInformationMessage('Once Colima is successfully started, refresh the components view.', 'Refresh').then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            }
                        });
                    }
                });
            }
        });

        // Detect Podman
        const podmanCliInfo = await this.getCliInfo('podman --version', ComponentsManager.podmanVersionRegExp, true, true);
        components.push({
            name: 'Podman',
            icon: 'box',
            version: podmanCliInfo.version,
            status: podmanCliInfo.status,
            required: false,
            information: 'https://podman.io',
            installation: async () => {
                await env.openExternal(Uri.parse('https://podman.io/getting-started/installation'));
            },
            start: async () => {
                await tasks.executeTask({
                    name: 'Podman',
                    detail: 'Start Podman Machine',
                    definition: {
                        type: 'Start Podman Machine'
                    },
                    source: 'GitHub Local Actions',
                    scope: TaskScope.Workspace,
                    isBackground: true,
                    presentationOptions: {
                        reveal: TaskRevealKind.Always,
                        focus: false,
                        clear: true,
                        close: false,
                        echo: true,
                        panel: TaskPanelKind.Shared,
                        showReuseMessage: false
                    },
                    problemMatchers: [],
                    runOptions: {},
                    group: TaskGroup.Build,
                    execution: new ShellExecution('podman machine start')
                });

                window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(4000);

                    const newPodmanCliInfo = await this.getCliInfo('podman --version', ComponentsManager.podmanVersionRegExp, true, true);
                    if (podmanCliInfo.status !== newPodmanCliInfo.status) {
                        componentsTreeDataProvider.refresh();
                    } else {
                        window.showInformationMessage('Once Podman is successfully started, refresh the components view.', 'Refresh').then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            }
                        });
                    }
                });
            }
        });

        // Detect Lume
        const lumeCliInfo = await this.getCliInfo('lume --version', ComponentsManager.lumeVersionRegExp, true, true);
        const lumeSocketPath = ConfigurationManager.get<string>(Section.lumeSocketPath);
        components.push({
            name: 'Lume',
            icon: 'vm',
            version: lumeCliInfo.version,
            path: lumeSocketPath,
            status: lumeCliInfo.status,
            required: false,
            information: 'https://cua.ai/docs/lume',
            installation: async () => {
                await env.openExternal(Uri.parse('https://cua.ai/docs/lume/guide/getting-started/installation'));
            },
            start: async () => {
                await tasks.executeTask({
                    name: 'Lume',
                    detail: 'Start Lume VM',
                    definition: {
                        type: 'Start Lume VM'
                    },
                    source: 'GitHub Local Actions',
                    scope: TaskScope.Workspace,
                    isBackground: true,
                    presentationOptions: {
                        reveal: TaskRevealKind.Always,
                        focus: false,
                        clear: true,
                        close: false,
                        echo: true,
                        panel: TaskPanelKind.Shared,
                        showReuseMessage: false
                    },
                    problemMatchers: [],
                    runOptions: {},
                    group: TaskGroup.Build,
                    execution: new ShellExecution('lume serve')
                });

                window.withProgress({ location: { viewId: ComponentsTreeDataProvider.VIEW_ID } }, async () => {
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(4000);

                    const newLumeCliInfo = await this.getCliInfo('lume --version', ComponentsManager.lumeVersionRegExp, true, true);
                    if (lumeCliInfo.status !== newLumeCliInfo.status) {
                        componentsTreeDataProvider.refresh();
                    } else {
                        window.showInformationMessage('Once Lume is successfully started, refresh the components view.', 'Refresh').then(async value => {
                            if (value === 'Refresh') {
                                componentsTreeDataProvider.refresh();
                            }
                        });
                    }
                });
            }
        });

        // const githubActionsInfo = await this.getExtensionInfo('github.vscode-github-actions');
        // components.push({
        //     name: 'GitHub Actions Extension',
        //     icon: 'extensions',
        //     version: githubActionsInfo.version,
        //     status: githubActionsInfo.status,
        //     required: false,
        //     information: 'https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions',
        //     installation: async () => {
        //         await env.openExternal(Uri.parse('https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions'));
        //     },
        //     message: 'GitHub Actions extension is not required, but is recommended to take advantage of workflow editor features.'
        // });

        // const githubCliInfo = await this.getCliInfo('gh', /gh version (.+)/, false, false);
        // components.push({
        //     name: 'GitHub CLI',
        //     icon: 'terminal',
        //     version: githubCliInfo.version,
        //     status: githubCliInfo.status,
        //     required: false,
        //     information: 'https://cli.github.com',
        //     installation: async () => {
        //         await env.openExternal(Uri.parse('https://cli.github.com'));
        //     },
        //     message: 'GitHub CLI is not required, but is recommended if you plan to use it to retrieve GitHub tokens.'
        // });

        return components;
    }

    async getUnreadyComponents(): Promise<Component<CliStatus | ExtensionStatus>[]> {
        const components = await this.getComponents();
        return components.filter(component => component.required && [CliStatus.NotInstalled, CliStatus.NotRunning, CliStatus.InvalidPermissions, ExtensionStatus.NotActivated].includes(component.status));
    }

    async getCliInfo(command: string, versionRegex: RegExp, ignoreError: boolean, checksIfRunning: boolean): Promise<{ version?: string, status: CliStatus }> {
        return new Promise<{ version?: string, status: CliStatus }>((resolve, reject) => {
            childProcess.exec(command, (error, stdout, stderr) => {
                const version = stdout?.match(versionRegex);

                if (error) {
                    if (ignoreError && version) {
                        resolve({
                            version: version[1],
                            status: (process.platform === Platform.linux && error.message.toLowerCase().includes('permission denied')) ?
                                CliStatus.InvalidPermissions :
                                CliStatus.NotRunning
                        });
                    } else {
                        resolve({
                            status: CliStatus.NotInstalled
                        });
                    }
                } else {
                    if (checksIfRunning) {
                        resolve({
                            version: version ? version[1] : undefined,
                            status: CliStatus.Running
                        });
                    } else {
                        resolve({
                            version: version ? version[1] : undefined,
                            status: CliStatus.Installed
                        });
                    }
                }
            });
        });
    }

    async getExtensionInfo(extensionId: string): Promise<{ version?: string, status: ExtensionStatus }> {
        const allExtensions = extensions.all;
        const extension = allExtensions.find(extension => extension.id === extensionId);

        if (extension) {
            if (!extension.isActive) {
                await extension.activate();
            }

            return {
                status: ExtensionStatus.Activated,
                version: extension.packageJSON.version
            };
        } else {
            return {
                status: ExtensionStatus.NotActivated
            };
        }
    }
}