const scalarCellSchema = { type: ["string", "number", "boolean", "null"] };
const matrixSchema = { type: "array", items: { type: "array", items: scalarCellSchema } };
const tableFormatSchema = { type: "object", additionalProperties: true };
const textFormatSchema = { type: "object", properties: { fontName: { type: "string" }, fontSize: { type: "number" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: { type: "string" }, highlightColor: { type: "string" } }, additionalProperties: false };
const paragraphFormatSchema = { type: "object", properties: { alignment: { type: "string" }, lineSpacing: { type: "number" }, spaceBefore: { type: "number" }, spaceAfter: { type: "number" }, firstLineIndent: { type: "number" }, leftIndent: { type: "number" }, rightIndent: { type: "number" }, keepWithNext: { type: "boolean" }, pageBreakBefore: { type: "boolean" } }, additionalProperties: false };

export const tools = [
  {
    name: "wps.list_sessions",
    description: "List active WPS add-in sessions registered with the local bridge.",
    inputSchema: { type: "object", properties: { onlyOnline: { type: "boolean" }, onlyBound: { type: "boolean" }, host: { type: "string" }, projectId: { type: "string" }, threadId: { type: "string" }, binding: { type: "object", additionalProperties: true } }, additionalProperties: false },
  },
  {
    name: "wps.connection_status",
    description: "Diagnose WPS Connector bridge, add-in, sessions, binding, and recommended session routing for other models or agents before calling Writer/Spreadsheet tools.",
    inputSchema: {
      type: "object",
      properties: {
        onlyOnline: { type: "boolean" },
        onlyBound: { type: "boolean" },
        host: { type: "string" },
        sessionId: { type: "string" },
        projectId: { type: "string" },
        projectName: { type: "string" },
        projectPath: { type: "string" },
        threadId: { type: "string" },
        conversationId: { type: "string" },
        binding: { type: "object", additionalProperties: true }
      },
      additionalProperties: false
    },
  },
  {
    name: "et.read_selection",
    description: "Read the current WPS Spreadsheet selection.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "et.list_worksheets",
    description: "List worksheets in the active WPS Spreadsheet workbook.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "et.add_worksheet",
    description: "Add a worksheet to the active WPS Spreadsheet workbook.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, name: { type: "string" }, sheetName: { type: "string" }, activate: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "et.rename_worksheet",
    description: "Rename a worksheet in the active WPS Spreadsheet workbook.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, oldName: { type: "string" }, newName: { type: "string" }, activate: { type: "boolean" } },
      required: ["oldName", "newName"],
      additionalProperties: false,
    },
  },
  {
    name: "et.delete_worksheet",
    description: "Delete a worksheet from the active WPS Spreadsheet workbook.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, force: { type: "boolean" } },
      required: ["sheetName"],
      additionalProperties: false,
    },
  },
  {
    name: "et.read_range",
    description: "Read a specific WPS Spreadsheet range.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, includeFormulas: { type: "boolean" }, includeFormats: { type: "boolean" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "et.write_range",
    description: "Write values to a WPS Spreadsheet range.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheetName: { type: "string" },
        address: { type: "string" },
        values: matrixSchema,
        formulas: matrixSchema,
        formulaRanges: { type: "array", items: { type: "object", properties: { address: { type: "string" }, formulas: matrixSchema }, required: ["address", "formulas"], additionalProperties: false } },
        numberFormats: matrixSchema,
        treatLeadingEqualsAsFormula: { type: "boolean" },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "et.format_range",
    description: "Format a WPS Spreadsheet range.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheetName: { type: "string" },
        address: { type: "string" },
        fontName: { type: "string" },
        fontSize: { type: "number" },
        bold: { type: "boolean" },
        fontColor: { type: "string" },
        fillColor: { type: "string" },
        numberFormat: { type: "string" },
        verticalAlignment: { type: "string" },
        wrapText: { type: "boolean" },
        rowHeight: { type: "number" },
        columnWidth: { type: "number" },
        horizontalAlignment: { type: "string" },
        border: { type: "boolean" },
        borderColor: { type: "string" },
        autofit: { type: "boolean" },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "et.clear_range",
    description: "Clear contents, formats, or all from a WPS Spreadsheet range.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, applyTo: { type: "string" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "et.insert_range",
    description: "Insert cells at a WPS Spreadsheet range and shift existing cells.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, shift: { type: "string" } },
      required: ["address", "shift"],
      additionalProperties: false,
    },
  },
  {
    name: "et.delete_range",
    description: "Delete cells at a WPS Spreadsheet range and shift remaining cells.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, shift: { type: "string" } },
      required: ["address", "shift"],
      additionalProperties: false,
    },
  },
  {
    name: "et.find_cells",
    description: "Find cells in a WPS Spreadsheet used range by displayed text or value.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, query: { type: "string" }, matchCase: { type: "boolean" }, matchEntireCell: { type: "boolean" }, maxResults: { type: "number" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "et.write_blocks",
    description: "Apply multiple WPS Spreadsheet write and format blocks with per-block results.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, continueOnError: { type: "boolean" }, blocks: { type: "array", items: { type: "object", properties: { sheetName: { type: "string" }, address: { type: "string" }, values: matrixSchema, formulas: matrixSchema, formulaRanges: { type: "array", items: { type: "object", properties: { address: { type: "string" }, formulas: matrixSchema }, required: ["address", "formulas"], additionalProperties: false } }, numberFormats: matrixSchema, format: { type: "object", additionalProperties: true } }, required: ["address"], additionalProperties: false } } },
      required: ["blocks"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_selection",
    description: "Read the current WPS Writer selection.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_document_identity",
    description: "Read current WPS Writer document identity.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.read_document_text",
    description: "Read text from the active WPS Writer document, with optional start/end character offsets.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, maxLength: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.select_range",
    description: "Select a character range in the active WPS Writer document.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" } },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.select_paragraph",
    description: "Select a one-based paragraph in the active WPS Writer document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" } }, required: ["index"], additionalProperties: false },
  },
  {
    name: "wpp.select_current_paragraph",
    description: "Select the paragraph containing the current WPS Writer cursor or selection.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.get_selection_range",
    description: "Return current WPS Writer selection native and normalized range information.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wpp.list_paragraphs",
    description: "List WPS Writer paragraphs with stable pagination, text previews, ranges, style metadata, and optional paragraph format summaries.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, startIndex: { type: "number" }, endIndex: { type: "number" }, rangeMode: { type: "string" }, maxCount: { type: "number" }, includeFormatSummary: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "wpp.get_paragraph_range",
    description: "Return native and normalized range metadata for a one-based WPS Writer paragraph.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" } }, required: ["index"], additionalProperties: false },
  },
  {
    name: "wpp.find_block",
    description: "Find a paragraph/section/table block by anchor text and return whole-block range metadata.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, anchorText: { type: "string" }, options: { type: "object", properties: { blockType: { type: "string" }, includeFollowingParagraphs: { type: "number" }, stopAtNextAnchor: { type: "boolean" }, matchWholeParagraph: { type: "boolean" } }, additionalProperties: false } }, required: ["anchorText"], additionalProperties: false },
  },
  {
    name: "wpp.find_text",
    description: "Find text in a WPS Writer document using the normalized Writer text model.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, query: { type: "string" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" }, maxResults: { type: "number" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.replace_text",
    description: "Replace text in WPS Writer while preserving surrounding paragraph and table formatting where the host permits.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, findText: { type: "string" }, replaceText: { type: "string" }, occurrence: { type: ["string", "number"] }, index: { type: "number" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" } },
      required: ["findText", "replaceText"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_format",
    description: "Read font and paragraph formatting from the current WPS Writer selection.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wpp.replace_paragraph",
    description: "Replace one whole WPS Writer paragraph by one-based paragraph index without silently crossing into the next paragraph.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" }, text: { type: "string" } }, required: ["index", "text"], additionalProperties: false },
  },
  {
    name: "wpp.replace_current_paragraph",
    description: "Replace the current WPS Writer paragraph containing the cursor or selection.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, text: { type: "string" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "wpp.replace_block",
    description: "Replace a whole paragraph/section block found by anchor text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, anchorText: { type: "string" }, text: { type: "string" }, options: { type: "object", additionalProperties: true } }, required: ["anchorText", "text"], additionalProperties: false },
  },
  {
    name: "wpp.insert_after_paragraph",
    description: "Insert text after a one-based WPS Writer paragraph index.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" }, text: { type: "string" } }, required: ["index", "text"], additionalProperties: false },
  },
  {
    name: "wpp.insert_before_paragraph",
    description: "Insert text before a one-based WPS Writer paragraph index.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" }, text: { type: "string" } }, required: ["index", "text"], additionalProperties: false },
  },
  {
    name: "wpp.insert_table_after_paragraph",
    description: "Insert a table after a one-based WPS Writer paragraph index without relying on character offsets.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" }, rowCount: { type: "number" }, columnCount: { type: "number" }, values: matrixSchema, headerRowBold: { type: "boolean" }, alignment: { type: "string" }, border: { type: "boolean" } }, required: ["index", "rowCount", "columnCount"], additionalProperties: false },
  },
  {
    name: "wpp.insert_table_before_paragraph",
    description: "Insert a table before a one-based WPS Writer paragraph index without relying on character offsets.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" }, rowCount: { type: "number" }, columnCount: { type: "number" }, values: matrixSchema, headerRowBold: { type: "boolean" }, alignment: { type: "string" }, border: { type: "boolean" } }, required: ["index", "rowCount", "columnCount"], additionalProperties: false },
  },
  {
    name: "wpp.read_text_format",
    description: "Read text formatting from the current selection or optional normalized start/end range.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "wpp.apply_text_format",
    description: "Apply font formatting to the current selection or optional normalized start/end range.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, format: textFormatSchema }, required: ["format"], additionalProperties: false },
  },
  {
    name: "wpp.read_paragraph_format",
    description: "Read paragraph formatting from the current selection, explicit range, or paragraph indexes. Multi-paragraph reads return perParagraphFormats and mixedFields.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, paragraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "wpp.apply_paragraph_format_by_indexes",
    description: "Apply paragraph formatting to one or more one-based WPS Writer paragraph indexes without relying on the current selection.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, paragraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, format: paragraphFormatSchema, dryRun: { type: "boolean" }, preview: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "wpp.copy_paragraph_format",
    description: "Copy paragraph formatting from one source paragraph to target paragraph indexes or a paragraph range without changing document text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceParagraphIndex: { type: "number" }, targetParagraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, fields: { type: "array", items: { type: "string" } }, dryRun: { type: "boolean" }, preview: { type: "boolean" } }, required: ["sourceParagraphIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_table",
    description: "Read a WPS Writer table by one-based index.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_table_cell",
    description: "Read one WPS Writer table cell by one-based table, row, and column, including merge and format metadata.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, row: { type: "number" }, column: { type: "number" }, col: { type: "number" } },
      required: ["tableIndex", "row"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.write_table_cell",
    description: "Write text to one WPS Writer table cell while preserving cell style by default.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, row: { type: "number" }, column: { type: "number" }, col: { type: "number" }, text: { type: "string" }, preserveStyle: { type: "boolean" } },
      required: ["tableIndex", "row", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.insert_table_rows",
    description: "Insert rows into a WPS Writer table before or after a one-based row index.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, rowIndex: { type: "number" }, count: { type: "number" }, position: { type: "string" } },
      required: ["rowIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.delete_table_rows",
    description: "Delete rows from a WPS Writer table.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, rowIndex: { type: "number" }, count: { type: "number" } },
      required: ["rowIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.insert_table_columns",
    description: "Insert columns into a WPS Writer table before or after a one-based column index.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, columnIndex: { type: "number" }, count: { type: "number" }, position: { type: "string" } },
      required: ["columnIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.delete_table_columns",
    description: "Delete columns from a WPS Writer table.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, columnIndex: { type: "number" }, count: { type: "number" } },
      required: ["columnIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.merge_table_cells",
    description: "Merge a rectangular cell range in a WPS Writer table.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, startRow: { type: "number" }, startColumn: { type: "number" }, endRow: { type: "number" }, endColumn: { type: "number" } },
      required: ["startRow", "startColumn", "endRow", "endColumn"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.format_table",
    description: "Format a WPS Writer table, including borders, alignment, header row, and autofit.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, border: { type: "boolean" }, alignment: { type: "string" }, headerRowBold: { type: "boolean" }, autofit: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_table_format",
    description: "Read complete WPS Writer table formatting, including table, cell, row height, column width, borders, padding, and merged-cell metadata.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.apply_table_format",
    description: "Apply a structured table format object to a WPS Writer table without changing cell text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, format: tableFormatSchema }, required: ["tableIndex", "format"], additionalProperties: false },
  },
  {
    name: "wpp.copy_table_style",
    description: "Copy table appearance from one WPS Writer table to another. Scope: table_only, cell_style, row_height, col_width, merged_cells, or all.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceTableIndex: { type: "number" }, targetTableIndex: { type: "number" }, scope: { type: ["string", "array"], items: { type: "string" } } }, required: ["sourceTableIndex", "targetTableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.duplicate_table_appearance",
    description: "Make a target WPS Writer table look like a source table while keeping target content by default.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceTableIndex: { type: "number" }, targetTableIndex: { type: "number" }, keepContent: { type: "boolean" } }, required: ["sourceTableIndex", "targetTableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_cell_format",
    description: "Read formatting from one WPS Writer table cell.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, row: { type: "number" }, col: { type: "number" }, column: { type: "number" } }, required: ["tableIndex", "row"], additionalProperties: false },
  },
  {
    name: "wpp.apply_cell_format",
    description: "Apply formatting to one WPS Writer table cell without changing its text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, row: { type: "number" }, col: { type: "number" }, column: { type: "number" }, format: tableFormatSchema }, required: ["tableIndex", "row", "format"], additionalProperties: false },
  },
  {
    name: "wpp.read_row_heights",
    description: "Read WPS Writer table row heights.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.set_row_heights",
    description: "Set WPS Writer table row heights.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, rowHeights: { type: "array", items: { type: "object", additionalProperties: true } }, rows: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_column_widths",
    description: "Read WPS Writer table column widths.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.set_column_widths",
    description: "Set WPS Writer table column widths.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, columnWidths: { type: "array", items: { type: "object", additionalProperties: true } }, columns: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_merged_cells",
    description: "Read merged-cell regions from a WPS Writer table when exposed by the host.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.apply_merged_cells",
    description: "Apply merged-cell regions to a WPS Writer table.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, mergedCells: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["tableIndex", "mergedCells"], additionalProperties: false },
  },
  {
    name: "wpp.insert_image",
    description: "Insert an image into WPS Writer from a local path or URL, with optional width/height.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, path: { type: "string" }, url: { type: "string" }, width: { type: "number" }, height: { type: "number" }, lockAspectRatio: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_images",
    description: "Read inline image metadata from the active WPS Writer document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.format_image",
    description: "Format an inline image by one-based index, including width, height, and lockAspectRatio.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, imageIndex: { type: "number" }, width: { type: "number" }, height: { type: "number" }, lockAspectRatio: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.delete_image",
    description: "Delete an inline image by one-based index.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, imageIndex: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.add_comment",
    description: "Add a real WPS Writer comment to the current selection or a specified character range.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, text: { type: "string" }, author: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_comments",
    description: "Read comments from the active WPS Writer document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.delete_comment",
    description: "Delete a WPS Writer comment by one-based index. commentId is supported only when returned by this connector in the current document session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, index: { type: "number" }, commentId: { type: "string" } },
      additionalProperties: false,
    },
  },

  {
    name: "wpp.set_track_changes",
    description: "Enable or disable WPS Writer track changes when supported by the host.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false },
  },
  {
    name: "wpp.read_revisions",
    description: "Read WPS Writer revisions / tracked changes when supported by the host.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.accept_revision",
    description: "Accept one WPS Writer revision by one-based index.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" } }, required: ["index"], additionalProperties: false },
  },
  {
    name: "wpp.reject_revision",
    description: "Reject one WPS Writer revision by one-based index.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, index: { type: "number" } }, required: ["index"], additionalProperties: false },
  },
  {
    name: "wpp.accept_all_revisions",
    description: "Accept all WPS Writer revisions when supported by the host.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.reject_all_revisions",
    description: "Reject all WPS Writer revisions when supported by the host.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wpp.list_styles",
    description: "List WPS Writer styles visible to the active document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wpp.apply_style",
    description: "Apply a named WPS Writer style to the current selection or optional normalized start/end range.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, styleName: { type: "string" } }, required: ["styleName"], additionalProperties: false },
  },
  {
    name: "wpp.insert_page_break",
    description: "Insert a page break at the current selection or optional normalized start offset.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "wpp.insert_paragraph_break",
    description: "Insert a paragraph break at the current selection or optional normalized start offset.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "wpp.delete_extra_blank_paragraphs",
    description: "Delete repeated blank paragraphs while preserving normal paragraph formatting.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wpp.save_document",
    description: "Save the active WPS Writer document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wpp.insert_news_article",
    description: "Insert a formatted news article into WPS Writer.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        body: { type: "string" },
        sourceNote: { type: "string" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.insert_text",
    description: "Insert text into the current WPS Writer selection or insertion point.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.format_selection",
    description: "Format the current WPS Writer selection.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, fontName: { type: "string" }, fontSize: { type: "number" }, bold: { type: "boolean" }, italic: { type: "boolean" }, fontColor: { type: "string" }, alignment: { type: "string" }, spaceBefore: { type: "number" }, spaceAfter: { type: "number" }, lineSpacing: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.set_paragraph",
    description: "Set paragraph formatting for the current selection or optional normalized start/end range. Supports legacy top-level fields and format object.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, format: paragraphFormatSchema, alignment: { type: "string" }, spaceBefore: { type: "number" }, spaceAfter: { type: "number" }, lineSpacing: { type: "number" }, firstLineIndent: { type: "number" }, leftIndent: { type: "number" }, rightIndent: { type: "number" }, keepWithNext: { type: "boolean" }, pageBreakBefore: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.insert_table",
    description: "Insert a WPS Writer table at the current selection, with optional header bold, alignment, and borders.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, rowCount: { type: "number" }, columnCount: { type: "number" }, values: matrixSchema, headerRowBold: { type: "boolean" }, alignment: { type: "string" }, border: { type: "boolean" } },
      required: ["rowCount", "columnCount"],
      additionalProperties: false,
    },
  },
];
