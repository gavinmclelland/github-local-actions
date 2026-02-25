import * as fs from "fs/promises";
import * as path from "path";
import { RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import * as yaml from "yaml";
import { ConfigurationManager, Section } from "./configurationManager";
import { outputChannel } from "./extension";

export interface Workflow {
  name: string,
  uri: Uri,
  fileContent?: string,
  yaml?: any,
  error?: string
}

export interface Job {
  name: string
  id: string
}

// Cache entry for a single workflow file
interface WorkflowCacheEntry {
  name: string;
  uri: Uri;
  fileContent: string;
  yaml: any;
  mtime: number;
  cachedAt: number;
}

// Cache structure: workspacePath -> workflowFilePath -> CacheEntry
type WorkflowCache = Map<string, Map<string, WorkflowCacheEntry>>;

export class WorkflowsManager {
  static defaultWorkflowsDirectory: string = '.github/workflows';
  static yamlExtension: string = 'yaml';
  static ymlExtension: string = 'yml';

  // In-memory cache for workflow content
  private static cache: WorkflowCache = new Map();

  static getWorkflowsDirectory(workspaceFolder?: WorkspaceFolder): string {
    let dir = ConfigurationManager.get<string>(Section.workflowsDirectory) || WorkflowsManager.defaultWorkflowsDirectory;
    // Handle ${workspaceFolder} variable substitution - RelativePattern needs relative path
    if (workspaceFolder && dir.includes('${workspaceFolder}')) {
      dir = dir.replace(/\$\{workspaceFolder\}/g, '').replace(/^\/+/, '');
    }
    return dir;
  }

  // Track in-progress requests to prevent duplicates
  private static inProgress = new Map<string, Promise<Workflow[]>>();

  async getWorkflows(workspaceFolder: WorkspaceFolder): Promise<Workflow[]> {
    const key = workspaceFolder.uri.fsPath;

    // If already loading, wait for that promise
    if (WorkflowsManager.inProgress.has(key)) {
      outputChannel.appendLine(`Already loading workflows for: ${key}, waiting...`);
      return WorkflowsManager.inProgress.get(key)!;
    }

    // Check cache first
    const cached = await this.getCachedWorkflows(workspaceFolder);
    if (cached) {
      outputChannel.appendLine(`Using cached workflows for: ${key}`);
      return cached;
    }

    // Create the actual work promise
    const workPromise = this.doGetWorkflows(workspaceFolder);
    WorkflowsManager.inProgress.set(key, workPromise);

    try {
      return await workPromise;
    } finally {
      WorkflowsManager.inProgress.delete(key);
    }
  }

  private async getCachedWorkflows(workspaceFolder: WorkspaceFolder): Promise<Workflow[] | null> {
    const workspaceKey = workspaceFolder.uri.fsPath;
    const workspaceCache = WorkflowsManager.cache.get(workspaceKey);

    if (!workspaceCache) {
      return null;
    }

    // Get directory path
    const rawDir = ConfigurationManager.get<string>(Section.workflowsDirectory) || WorkflowsManager.defaultWorkflowsDirectory;
    let relativeDir = rawDir.replace(/\$\{workspaceFolder\}/g, '').replace(/^\/+/, '');
    const workflowsDirPath = path.join(workspaceKey, relativeDir);

    const workflows: Workflow[] = [];
    const currentFiles = new Set<string>();

    // Check each cached file and verify it still exists/is valid
    for (const [filePath, entry] of workspaceCache) {
      currentFiles.add(filePath);

      // Check if file still exists and hasn't been modified
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs === entry.mtime) {
          // File hasn't changed, use cached version
          workflows.push({
            name: entry.name,
            uri: entry.uri,
            fileContent: entry.fileContent,
            yaml: entry.yaml
          });
        } else {
          // File has been modified, remove from cache
          workspaceCache.delete(filePath);
        }
      } catch {
        // File no longer exists, remove from cache
        workspaceCache.delete(filePath);
      }
    }

    // If cache was fully valid, return it
    if (workflows.length === workspaceCache.size && workflows.length > 0) {
      return workflows;
    }

    // Cache is stale, clear it
    WorkflowsManager.cache.delete(workspaceKey);
    return null;
  }

  private async doGetWorkflows(workspaceFolder: WorkspaceFolder): Promise<Workflow[]> {
    const workflows: Workflow[] = [];
    const workspaceKey = workspaceFolder.uri.fsPath;

    outputChannel.appendLine(`Loading workflows for: ${workspaceKey}`);

    // Check workspace state
    const allFolders = workspace.workspaceFolders;
    outputChannel.appendLine(`Total workspace folders: ${allFolders?.length || 0}`);
    allFolders?.forEach((f, i) => outputChannel.appendLine(`  Folder ${i}: ${f.uri.fsPath}`));

    // Get directory and handle variable substitution
    const rawDir = ConfigurationManager.get<string>(Section.workflowsDirectory) || WorkflowsManager.defaultWorkflowsDirectory;
    // Remove ${workspaceFolder} to get relative path for RelativePattern
    let relativeDir = rawDir.replace(/\$\{workspaceFolder\}/g, '').replace(/^\/+/, '');
    outputChannel.appendLine(`Using workflow directory: ${relativeDir}`);

    // Try using fs directly instead of workspace.findFiles (which can hang)
    const workflowsDirPath = path.join(workspaceFolder.uri.fsPath, relativeDir);
    outputChannel.appendLine(`Reading directory directly: ${workflowsDirPath}`);

    let workflowFileUris: Uri[] = [];
    try {
      const entries = await fs.readdir(workflowsDirPath, { withFileTypes: true });
      outputChannel.appendLine(`Directory has ${entries.length} entries`);

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (ext === '.yml' || ext === '.yaml') {
            const filePath = path.join(workflowsDirPath, entry.name);
            outputChannel.appendLine(`Found workflow file: ${filePath}`);
            workflowFileUris.push(Uri.file(filePath));
          }
        }
      }
      outputChannel.appendLine(`Found ${workflowFileUris.length} workflow files`);
    } catch (error: any) {
      outputChannel.appendLine(`ERROR reading directory: ${error.message || error}`);
      // Fall back to findFiles
      outputChannel.appendLine(`Trying findFiles as fallback...`);
      try {
        const pattern = `${relativeDir}/*.{${WorkflowsManager.yamlExtension},${WorkflowsManager.ymlExtension}}`;
        const relativePattern = new RelativePattern(workspaceFolder, pattern);
        workflowFileUris = await workspace.findFiles(relativePattern);
        outputChannel.appendLine(`findFiles returned ${workflowFileUris.length} files`);
      } catch (err: any) {
        outputChannel.appendLine(`Fallback findFiles also failed: ${err.message || err}`);
        return workflows;
      }
    }

    // Initialize workspace cache if needed
    if (!WorkflowsManager.cache.has(workspaceKey)) {
      WorkflowsManager.cache.set(workspaceKey, new Map());
    }
    const workspaceCache = WorkflowsManager.cache.get(workspaceKey)!;

    for await (const workflowFileUri of workflowFileUris) {
      let yamlContent: any | undefined;

      try {
        const fileContent = await fs.readFile(workflowFileUri.fsPath, 'utf8');
        const stats = await fs.stat(workflowFileUri.fsPath);
        yamlContent = yaml.parse(fileContent);

        const workflow: Workflow = {
          name: yamlContent.name || path.parse(workflowFileUri.fsPath).name,
          uri: workflowFileUri,
          fileContent: fileContent,
          yaml: yamlContent
        };
        workflows.push(workflow);

        // Cache the workflow content
        workspaceCache.set(workflowFileUri.fsPath, {
          name: workflow.name,
          uri: workflowFileUri,
          fileContent: fileContent,
          yaml: yamlContent,
          mtime: stats.mtimeMs,
          cachedAt: Date.now()
        });
      } catch (error: any) {
        workflows.push({
          name: (yamlContent ? yamlContent.name : undefined) || path.parse(workflowFileUri.fsPath).name,
          uri: workflowFileUri,
          error: 'Failed to parse workflow'
        });
      }
    }

    outputChannel.appendLine(`Cached ${workflows.length} workflows`);
    return workflows;
  }

  // Clear cache for a workspace (useful for testing or manual refresh)
  static clearCache(workspacePath?: string): void {
    if (workspacePath) {
      WorkflowsManager.cache.delete(workspacePath);
    } else {
      WorkflowsManager.cache.clear();
    }
  }
}