import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

/**
 * 工作流版本管理器
 * 支持多版本工作流定义的存储和查询
 */
export class WorkflowVersionManager {
  // workflowId -> version -> definition
  private versions = new Map<string, Map<string, WorkflowDefinition>>();
  // workflowId -> latest version
  private latestVersions = new Map<string, string>();

  /**
   * 注册工作流版本
   */
  register(workflow: WorkflowDefinition): void {
    const version = workflow.version || "1.0.0";
    const workflowWithMeta: WorkflowDefinition = {
      ...workflow,
      version,
      createdAt: workflow.createdAt || new Date(),
      updatedAt: new Date(),
    };

    let versionMap = this.versions.get(workflow.id);
    if (!versionMap) {
      versionMap = new Map();
      this.versions.set(workflow.id, versionMap);
    }

    versionMap.set(version, workflowWithMeta);

    // 更新最新版本
    const currentLatest = this.latestVersions.get(workflow.id);
    if (!currentLatest || this.compareVersions(version, currentLatest) > 0) {
      this.latestVersions.set(workflow.id, version);
    }

    Logger.info(
      "system",
      "version",
      `Registered workflow ${workflow.id} version ${version}`,
    );
  }

  /**
   * 获取指定版本的工作流
   */
  get(workflowId: string, version?: string): WorkflowDefinition | undefined {
    const versionMap = this.versions.get(workflowId);
    if (!versionMap) return undefined;

    if (version) {
      return versionMap.get(version);
    }

    // 返回最新版本
    const latestVersion = this.latestVersions.get(workflowId);
    if (latestVersion) {
      return versionMap.get(latestVersion);
    }

    return undefined;
  }

  /**
   * 获取工作流的所有版本
   */
  getVersions(workflowId: string): string[] {
    const versionMap = this.versions.get(workflowId);
    if (!versionMap) return [];
    return Array.from(versionMap.keys()).sort(this.compareVersions);
  }

  /**
   * 获取最新版本号
   */
  getLatestVersion(workflowId: string): string | undefined {
    return this.latestVersions.get(workflowId);
  }

  /**
   * 列出所有工作流 ID
   */
  listWorkflows(): string[] {
    return Array.from(this.versions.keys());
  }

  /**
   * 删除指定版本
   */
  deleteVersion(workflowId: string, version: string): boolean {
    const versionMap = this.versions.get(workflowId);
    if (!versionMap) return false;

    const deleted = versionMap.delete(version);

    if (deleted) {
      // 如果删除的是最新版本，重新计算最新版本
      if (this.latestVersions.get(workflowId) === version) {
        const remaining = Array.from(versionMap.keys());
        if (remaining.length > 0) {
          remaining.sort(this.compareVersions);
          this.latestVersions.set(workflowId, remaining[remaining.length - 1]);
        } else {
          this.latestVersions.delete(workflowId);
          this.versions.delete(workflowId);
        }
      }
      Logger.info(
        "system",
        "version",
        `Deleted workflow ${workflowId} version ${version}`,
      );
    }

    return deleted;
  }

  /**
   * 删除工作流的所有版本
   */
  deleteWorkflow(workflowId: string): boolean {
    const deleted = this.versions.delete(workflowId);
    this.latestVersions.delete(workflowId);

    if (deleted) {
      Logger.info(
        "system",
        "version",
        `Deleted all versions of workflow ${workflowId}`,
      );
    }

    return deleted;
  }

  /**
   * 比较版本号
   * 返回: 正数表示 a > b, 负数表示 a < b, 0 表示相等
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
    const partsB = b.split(".").map((n) => Number.parseInt(n, 10) || 0);

    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) {
        return numA - numB;
      }
    }

    return 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalWorkflows: number;
    totalVersions: number;
    workflows: Array<{ id: string; versions: number; latest: string }>;
  } {
    const workflows: Array<{ id: string; versions: number; latest: string }> =
      [];
    let totalVersions = 0;

    for (const [id, versionMap] of this.versions) {
      const versionCount = versionMap.size;
      totalVersions += versionCount;
      workflows.push({
        id,
        versions: versionCount,
        latest: this.latestVersions.get(id) || "unknown",
      });
    }

    return {
      totalWorkflows: this.versions.size,
      totalVersions,
      workflows,
    };
  }
}

// 全局版本管理器实例
let versionManagerInstance: WorkflowVersionManager | null = null;

export function getVersionManager(): WorkflowVersionManager {
  if (!versionManagerInstance) {
    versionManagerInstance = new WorkflowVersionManager();
  }
  return versionManagerInstance;
}

export function setVersionManager(manager: WorkflowVersionManager): void {
  versionManagerInstance = manager;
}
