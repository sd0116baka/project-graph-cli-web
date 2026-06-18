export const PROJECT_GRAPH_OPS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://graphif.github.io/project-graph/schemas/project-graph-ops.schema.json",
  title: "Project Graph patch operations",
  description: "Operation payload accepted by project-graph patch and project-graph live patch.",
  oneOf: [
    {
      $ref: "#/$defs/patch",
    },
    {
      type: "array",
      items: {
        $ref: "#/$defs/operation",
      },
    },
  ],
  $defs: {
    patch: {
      type: "object",
      additionalProperties: false,
      required: ["ops"],
      properties: {
        baseRevision: {
          type: "integer",
          description: "Optional optimistic revision marker for live clients.",
        },
        ops: {
          type: "array",
          items: {
            $ref: "#/$defs/operation",
          },
        },
      },
    },
    operation: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "text"],
          properties: {
            op: {
              const: "add_text_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            text: {
              type: "string",
            },
            position: {
              $ref: "#/$defs/point",
            },
            size: {
              $ref: "#/$defs/size",
            },
            detailsMarkdown: {
              type: "string",
            },
            color: {
              $ref: "#/$defs/color",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "text"],
          properties: {
            op: {
              const: "rename_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            text: {
              type: "string",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "markdown"],
          properties: {
            op: {
              const: "set_node_details_markdown",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            markdown: {
              type: "string",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "position"],
          properties: {
            op: {
              const: "move_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            position: {
              $ref: "#/$defs/point",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "size"],
          properties: {
            op: {
              const: "resize_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            size: {
              $ref: "#/$defs/size",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "source", "target"],
          properties: {
            op: {
              const: "connect",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            source: {
              $ref: "#/$defs/objectId",
            },
            target: {
              $ref: "#/$defs/objectId",
            },
            text: {
              type: "string",
            },
            lineType: {
              type: "string",
              description: "Common values are solid, dashed, and double.",
            },
            color: {
              $ref: "#/$defs/color",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "text"],
          properties: {
            op: {
              const: "set_edge_text",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            text: {
              type: "string",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id"],
          properties: {
            op: {
              const: "delete_object",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "color"],
          properties: {
            op: {
              const: "set_color",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            color: {
              $ref: "#/$defs/color",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "markdown"],
          properties: {
            op: {
              const: "import_markdown",
            },
            markdown: {
              type: "string",
            },
            origin: {
              $ref: "#/$defs/point",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "mermaid"],
          properties: {
            op: {
              const: "import_mermaid",
            },
            mermaid: {
              type: "string",
            },
            origin: {
              $ref: "#/$defs/point",
            },
          },
        },
      ],
    },
    objectId: {
      type: "string",
      minLength: 1,
    },
    point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: {
          type: "number",
        },
        y: {
          type: "number",
        },
      },
    },
    size: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height"],
      properties: {
        width: {
          type: "number",
          exclusiveMinimum: 0,
        },
        height: {
          type: "number",
          exclusiveMinimum: 0,
        },
      },
    },
    color: {
      type: "object",
      additionalProperties: false,
      required: ["r", "g", "b", "a"],
      properties: {
        r: {
          type: "number",
        },
        g: {
          type: "number",
        },
        b: {
          type: "number",
        },
        a: {
          type: "number",
        },
      },
    },
  },
} as const;
