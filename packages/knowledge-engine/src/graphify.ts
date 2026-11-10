// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

export interface GraphNode {
  id: string;
  label: string;
  type: 'document' | 'section' | 'concept';
  content?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Parse markdown files, grouping headers into nodes and mapping links between sections. */
export function graphifyMarkdown(markdown: string, documentName: string): KnowledgeGraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const documentNodeId = `doc:${documentName}`;
  nodes.push({
    id: documentNodeId,
    label: documentName,
    type: 'document'
  });

  const lines = markdown.split('\n');
  let currentSectionId: string | null = null;

  for (const line of lines) {
    // Parse headers (e.g. # Header Title)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      const sectionId = `${documentNodeId}:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      nodes.push({
        id: sectionId,
        label: title,
        type: 'section'
      });

      // Link to document
      if (level === 1) {
        links.push({
          source: documentNodeId,
          target: sectionId,
          relation: 'contains'
        });
      } else if (currentSectionId) {
        // Link sub-sections hierarchically
        links.push({
          source: currentSectionId,
          target: sectionId,
          relation: 'sub_section'
        });
      }

      currentSectionId = sectionId;
    }

    // Identify references (e.g. [[Linked Topic]])
    const wikiLinkMatch = line.match(/\[\[(.+?)\]\]/g);
    if (wikiLinkMatch) {
      for (const rawMatch of wikiLinkMatch) {
        const concept = rawMatch.slice(2, -2).trim();
        const conceptId = `concept:${concept.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        // Ensure concept node is added
        if (!nodes.some((n) => n.id === conceptId)) {
          nodes.push({
            id: conceptId,
            label: concept,
            type: 'concept'
          });
        }

        // Link current section/document to the concept
        links.push({
          source: currentSectionId || documentNodeId,
          target: conceptId,
          relation: 'references'
        });
      }
    }
  }

  return { nodes, links };
}
