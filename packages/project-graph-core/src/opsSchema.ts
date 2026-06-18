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
          description:
            "Optional caller revision marker. Live patch rejects mismatches; offline patch accepts it without enforcement.",
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
            section: {
              $ref: "#/$defs/objectId",
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
          required: ["op", "text"],
          properties: {
            op: {
              const: "add_section",
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
            collapsed: {
              type: "boolean",
            },
            locked: {
              type: "boolean",
            },
            children: {
              $ref: "#/$defs/objectIdArray",
            },
            section: {
              $ref: "#/$defs/objectId",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "text"],
          properties: {
            op: {
              const: "set_section_text",
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
              const: "set_section_details_markdown",
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
          required: ["op", "id", "collapsed"],
          properties: {
            op: {
              const: "set_section_collapsed",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            collapsed: {
              type: "boolean",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "locked"],
          properties: {
            op: {
              const: "set_section_locked",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            locked: {
              type: "boolean",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "children"],
          properties: {
            op: {
              const: "set_section_children",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            children: {
              $ref: "#/$defs/objectIdArray",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "children"],
          properties: {
            op: {
              const: "add_to_section",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            children: {
              $ref: "#/$defs/objectIdArray",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "id", "children"],
          properties: {
            op: {
              const: "remove_from_section",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            children: {
              $ref: "#/$defs/objectIdArray",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "dataBase64"],
          properties: {
            op: {
              const: "add_image_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            attachmentId: {
              $ref: "#/$defs/objectId",
            },
            dataBase64: {
              type: "string",
            },
            extension: {
              type: "string",
            },
            path: {
              type: "string",
            },
            position: {
              $ref: "#/$defs/point",
            },
            size: {
              $ref: "#/$defs/size",
            },
            scale: {
              type: "number",
              exclusiveMinimum: 0,
            },
            isBackground: {
              type: "boolean",
            },
            detailsMarkdown: {
              type: "string",
            },
            section: {
              $ref: "#/$defs/objectId",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "dataBase64"],
          properties: {
            op: {
              const: "add_svg_node",
            },
            id: {
              $ref: "#/$defs/objectId",
            },
            attachmentId: {
              $ref: "#/$defs/objectId",
            },
            dataBase64: {
              type: "string",
            },
            extension: {
              type: "string",
            },
            path: {
              type: "string",
            },
            position: {
              $ref: "#/$defs/point",
            },
            size: {
              $ref: "#/$defs/size",
            },
            scale: {
              type: "number",
              exclusiveMinimum: 0,
            },
            color: {
              $ref: "#/$defs/color",
            },
            detailsMarkdown: {
              type: "string",
            },
            section: {
              $ref: "#/$defs/objectId",
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
              const: "set_edge_style",
            },
            id: {
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
          required: ["op", "ids", "delta"],
          properties: {
            op: {
              const: "move_objects",
            },
            ids: {
              $ref: "#/$defs/objectIdArray",
            },
            delta: {
              $ref: "#/$defs/point",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op"],
          properties: {
            op: {
              const: "layout_grid",
            },
            ids: {
              $ref: "#/$defs/objectIdArray",
            },
            origin: {
              $ref: "#/$defs/point",
            },
            columns: {
              type: "integer",
              minimum: 1,
            },
            gap: {
              $ref: "#/$defs/size",
            },
            cell: {
              $ref: "#/$defs/size",
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
    objectIdArray: {
      type: "array",
      items: {
        $ref: "#/$defs/objectId",
      },
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
