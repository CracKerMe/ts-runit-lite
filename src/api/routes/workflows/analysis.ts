// oxlint-disable no-explicit-any -- workflow route handlers use dynamic types
import type { Router } from "express";
import { param, query, validationResult } from "express-validator";

import { Logger } from "../../../utils/Logger";
import { sendError, sendSuccess } from "../../response";
import { getRequestStorage } from "../../utils/requestContext";
import {
  buildGraph,
  getNodeSignature,
  reverseGraph,
  toEdgeSet,
  traverseGraph,
} from "./shared";

export function registerAnalysisRoutes(router: Router): void {
  router.get(
    "/:id/impact",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    query("fromVersion")
      .optional()
      .isInt({ min: 1 })
      .withMessage("fromVersion must be a positive integer"),
    query("toVersion")
      .optional()
      .isInt({ min: 1 })
      .withMessage("toVersion must be a positive integer"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const workflowId = req.params?.id;
        const fromVersionParam = req.query?.fromVersion as string | undefined;
        const toVersionParam = req.query?.toVersion as string | undefined;

        if (storage) {
          const metadata = await storage.loadWorkflowWithMetadata(workflowId);
          if (!metadata) {
            return sendError(
              res,
              404,
              404,
              `Workflow with ID ${workflowId} not found`,
            );
          }
          const versions = await storage.listWorkflowVersions(workflowId);
          const latest =
            versions.length > 0 ? versions[versions.length - 1] : undefined;
          const toVersion = toVersionParam
            ? Number.parseInt(toVersionParam, 10)
            : latest;
          if (!toVersion || !versions.includes(toVersion)) {
            return sendError(res, 404, 404, "Target version not found");
          }
          const fallbackFrom =
            metadata.publishedVersion && metadata.publishedVersion !== toVersion
              ? metadata.publishedVersion
              : versions.length > 1
                ? versions[versions.length - 2]
                : toVersion;
          const fromVersion = fromVersionParam
            ? Number.parseInt(fromVersionParam, 10)
            : fallbackFrom;
          if (!fromVersion || !versions.includes(fromVersion)) {
            return sendError(res, 404, 404, "Baseline version not found");
          }
          const fromWorkflow = await storage.loadWorkflowVersion(
            workflowId,
            fromVersion,
          );
          const toWorkflow = await storage.loadWorkflowVersion(
            workflowId,
            toVersion,
          );
          if (!fromWorkflow || !toWorkflow) {
            return sendError(res, 404, 404, "Workflow version not found");
          }
          const fromDef = fromWorkflow.definition;
          const toDef = toWorkflow.definition;
          const fromGraph = buildGraph(fromDef);
          const toGraph = buildGraph(toDef);
          const fromEdges = toEdgeSet(fromGraph);
          const toEdges = toEdgeSet(toGraph);
          const nodeIds = new Set<string>([
            ...Object.keys(fromDef.nodes || {}),
            ...Object.keys(toDef.nodes || {}),
          ]);
          const addedNodes: string[] = [];
          const removedNodes: string[] = [];
          const changedNodes: string[] = [];

          nodeIds.forEach((nodeId) => {
            const fromNode = fromDef.nodes?.[nodeId];
            const toNode = toDef.nodes?.[nodeId];
            if (!fromNode && toNode) {
              addedNodes.push(nodeId);
            } else if (fromNode && !toNode) {
              removedNodes.push(nodeId);
            } else if (fromNode && toNode) {
              if (getNodeSignature(fromNode) !== getNodeSignature(toNode)) {
                changedNodes.push(nodeId);
              }
            }
          });

          const addedEdges = Array.from(toEdges).filter(
            (edge) => !fromEdges.has(edge),
          );
          const removedEdges = Array.from(fromEdges).filter(
            (edge) => !toEdges.has(edge),
          );
          const impactSeeds = Array.from(
            new Set([...addedNodes, ...removedNodes, ...changedNodes]),
          );
          const downstream = traverseGraph(toGraph, impactSeeds);
          const upstream = traverseGraph(reverseGraph(toGraph), impactSeeds);
          const impactedNodes = new Set<string>([
            ...impactSeeds,
            ...Array.from(downstream),
            ...Array.from(upstream),
          ]);

          return sendSuccess(
            res,
            200,
            {
              workflowId,
              fromVersion,
              toVersion,
              addedNodes: addedNodes.sort(),
              removedNodes: removedNodes.sort(),
              changedNodes: changedNodes.sort(),
              addedEdges: addedEdges.sort(),
              removedEdges: removedEdges.sort(),
              impactedNodes: Array.from(impactedNodes).sort(),
              downstreamImpacts: Array.from(downstream).sort(),
              upstreamImpacts: Array.from(upstream).sort(),
            },
            "Workflow impact analysis completed",
          );
        }

        return sendError(
          res,
          500,
          500,
          "Workflow impact analysis not supported",
        );
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error analyzing workflow impact ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to analyze workflow impact",
        );
      }
    },
  );
}
