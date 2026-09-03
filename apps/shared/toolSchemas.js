const scalarCellSchema = { type: ["string", "number", "boolean", "null"] };
const matrixSchema = { type: "array", items: { type: "array", items: scalarCellSchema } };
const tableFormatSchema = { type: "object", additionalProperties: true };
const tableCellAddressSchema = { type: "object", properties: { row: { type: "number" }, col: { type: "number" }, column: { type: "number" } }, required: ["row"], additionalProperties: false };
const tableFieldsSchema = { type: "array", items: { type: "string" } };
const batchOperationSchema = { type: "object", properties: { operationId: { type: "string" }, tool: { type: "string" }, input: { type: "object", additionalProperties: true } }, required: ["tool"], additionalProperties: false };
const textFormatSchema = { type: "object", properties: { fontName: { type: "string" }, fontSize: { type: "number" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: { type: "string" }, highlightColor: { type: "string" } }, additionalProperties: false };
const paragraphFormatSchema = { type: "object", properties: { alignment: { type: "string" }, lineSpacing: { type: "number" }, lineSpacingRule: { type: ["string", "number"] }, lineSpacingValue: { type: "number" }, spaceBefore: { type: "number" }, spaceAfter: { type: "number" }, firstLineIndent: { type: "number" }, leftIndent: { type: "number" }, rightIndent: { type: "number" }, keepWithNext: { type: "boolean" }, pageBreakBefore: { type: "boolean" } }, additionalProperties: false };
const fontFormatSchema = { type: "object", properties: { fontName: { type: "string" }, fontSize: { type: "number" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: { type: "string" } }, additionalProperties: false };

export const tools = [
  {
    name: "wps.list_sessions",
    description: "List active WPS add-in sessions registered with the local bridge.",
    inputSchema: { type: "object", properties: { onlyOnline: { type: "boolean" }, includeOffline: { type: "boolean" }, onlyBound: { type: "boolean" }, host: { type: "string" }, sessionId: { type: "string" }, documentKey: { type: "string" }, projectId: { type: "string" }, threadId: { type: "string" }, binding: { type: "object", additionalProperties: true } }, additionalProperties: false },
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
    name: "wps.batch",
    description: "Run multiple WPS Connector tool operations sequentially in one bridge call, with per-step timing, dryRun, optional saveAfter, and optional verifyAfter operations.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        operations: { type: "array", items: batchOperationSchema },
        stopOnError: { type: "boolean" },
        dryRun: { type: "boolean" },
        saveAfter: { type: "boolean" },
        verifyAfter: { type: "array", items: batchOperationSchema }
      },
      required: ["operations"],
      additionalProperties: false
    },
  },
  {
    name: "wps.open_pane",
    description: "Open the WPS Connector task pane for the selected Writer or Spreadsheet session.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, host: { type: "string" }, view: { type: "string" }, documentKey: { type: "string" } }, additionalProperties: false },
  },

  {
    name: "wps.create_et_wpp_data_source",
    description: "Create or refresh a local WPS Spreadsheet data source for WPS Writer table synchronization. This does not require Codex project binding.",
    inputSchema: { type: "object", properties: { etSessionId: { type: "string" }, sessionId: { type: "string" }, sourceId: { type: "string" }, name: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, refreshSelection: { type: "boolean" }, headerRowCount: { type: "number" }, preserveFormatting: { type: "boolean" }, formatReadMode: { type: "string", enum: ["full", "profile"] } }, additionalProperties: false },
  },
  {
    name: "wps.list_et_wpp_data_sources",
    description: "List pending and bound WPS Spreadsheet data sources for WPS Writer table synchronization.",
    inputSchema: { type: "object", properties: { status: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wps.delete_et_wpp_data_source",
    description: "Delete an unbound WPS Spreadsheet data source.",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"], additionalProperties: false },
  },
  {
    name: "wps.unbind_et_wpp_data_source",
    description: "Unbind a WPS Spreadsheet data source from one or more WPS Writer tables while preserving the source definition.",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" }, syncId: { type: "string" } }, required: ["sourceId"], additionalProperties: false },
  },
  {
    name: "wps.unbind_et_wpp_data_sources",
    description: "Unbind selected WPS Spreadsheet to WPS Writer binding relations across multiple sources in one persisted operation.",
    inputSchema: { type: "object", properties: { bindings: { type: "array", items: { type: "object", properties: { sourceId: { type: "string" }, syncId: { type: "string" } }, required: ["sourceId", "syncId"], additionalProperties: false } } }, required: ["bindings"], additionalProperties: false },
  },
  {
    name: "wps.create_et_wpp_table_sync",
    description: "Bind a WPS Spreadsheet range/source to an existing WPS Writer table for repeatable synchronization.",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" }, syncId: { type: "string" }, name: { type: "string" }, etSessionId: { type: "string" }, wppSessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, wppTableIndex: { type: "number" }, tableIndex: { type: "number" }, allowStructuralChanges: { type: "boolean" }, allowCachedSource: { type: "boolean" }, headerRowCount: { type: "number" }, syncHeader: { type: "boolean" }, rowMatchEnabled: { type: "boolean" }, rowMatchKeyColumn: { type: "number" }, preserveUnmatchedWordRows: { type: "boolean" }, appendNewExcelRows: { type: "boolean" }, columnMapping: { type: "array", items: { type: "number" } }, refreshFormatting: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "wps.insert_et_wpp_data_source",
    description: "Insert a WPS Spreadsheet data source into the active WPS Writer document as a table and create the sync binding.",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" }, wppSessionId: { type: "string" }, operationId: { type: "string" }, headerRowCount: { type: "number" }, syncHeader: { type: "boolean" }, border: { type: "boolean" }, preserveFormatting: { type: "boolean" }, formatReadMode: { type: "string", enum: ["full", "profile"] }, refreshFormatting: { type: "boolean" }, allowCachedSource: { type: "boolean" } }, required: ["sourceId"], additionalProperties: false },
  },
  {
    name: "wps.list_et_wpp_table_syncs",
    description: "List saved WPS Spreadsheet to WPS Writer table sync bindings.",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "wps.sync_et_wpp_table",
    description: "Synchronize one WPS Writer table from its bound WPS Spreadsheet source.",
    inputSchema: { type: "object", properties: { syncId: { type: "string" }, previewOnly: { type: "boolean" }, headerRowCount: { type: "number" }, syncHeader: { type: "boolean" }, rowMatchEnabled: { type: "boolean" }, rowMatchKeyColumn: { type: "number" }, preserveUnmatchedWordRows: { type: "boolean" }, appendNewExcelRows: { type: "boolean" }, allowStructuralChanges: { type: "boolean" }, preserveFormatting: { type: "boolean" }, refreshFormatting: { type: "boolean" }, config: { type: "object", additionalProperties: true } }, required: ["syncId"], additionalProperties: false },
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
    name: "et.select_range",
    description: "Select and reveal a WPS Spreadsheet range for table sync source navigation.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" } }, required: ["address"], additionalProperties: false },
  },
  {
    name: "et.inspect_sheet_overlays",
    description: "Inspect WPS Spreadsheet floating shapes, comments, and data validation input messages on a worksheet.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, maxItems: { type: "number" }, includeValidation: { type: "boolean" }, maxRows: { type: "number" }, maxColumns: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "et.delete_sheet_overlays",
    description: "Delete WPS Spreadsheet floating shapes, comments, or validation input messages matching a text query.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, query: { type: "string" }, text: { type: "string" }, dryRun: { type: "boolean" }, deleteAll: { type: "boolean" }, maxRows: { type: "number" }, maxColumns: { type: "number" } }, additionalProperties: false },
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
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, includeFormulas: { type: "boolean" }, includeFormats: { type: "boolean" }, includeCellFormats: { type: "boolean" }, includeDisplayText: { type: "boolean" }, formatMode: { type: "string", enum: ["full", "profile"] }, formatProfileHeaderRows: { type: "number" } },
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
        italic: { type: "boolean" },
        underline: { type: ["boolean", "number", "string"] },
        indentLevel: { type: "number" },
        leftIndent: { type: "number" },
        firstLineIndent: { type: "number" },
        rightIndent: { type: "number" },
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
    name: "et.read_format_sample",
    description: "Read selected WPS Spreadsheet cell formats for specific addresses and fields without scanning a whole range.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, cells: { type: "array", items: { type: ["string", "object"], additionalProperties: true } }, fields: tableFieldsSchema },
      additionalProperties: false,
    },
  },
  {
    name: "et.verify_range",
    description: "Verify a WPS Spreadsheet range for common daily-use acceptance checks, currently including formula error cells.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, sheetName: { type: "string" }, address: { type: "string" }, checks: { type: "object", additionalProperties: true } },
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
    name: "et.save_workbook",
    description: "Save the active WPS Spreadsheet workbook.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, checksum: { type: "boolean" }, readback: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "et.create_chart",
    description: "Create or insert a chart in a WPS Spreadsheet worksheet as a floating object anchored to a cell.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheetName: { type: "string" },
        bindingId: { type: "string" },
        projectId: { type: "string" },
        threadId: { type: "string" },
        address: { type: "string" },
        chartType: { type: "string", enum: ["column", "bar", "line", "pie", "combo", "area", "scatter"] },
        dataRange: { type: "string" },
        categoryRange: { type: "string" },
        seriesRanges: { type: "array", items: { type: "string" } },
        title: { type: "string" },
        legendPosition: { type: "string", enum: ["top", "bottom", "left", "right", "none"] },
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["sessionId", "sheetName", "address", "chartType", "dataRange"],
      additionalProperties: false,
    },
  },
  {
    name: "et.insert_picture",
    description: "Insert a local or remote picture into a WPS Spreadsheet worksheet as a floating object anchored to a cell.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheetName: { type: "string" },
        bindingId: { type: "string" },
        projectId: { type: "string" },
        threadId: { type: "string" },
        address: { type: "string" },
        imagePath: { type: "string" },
        imageUrl: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        lockAspectRatio: { type: "boolean" }
      },
      required: ["sessionId", "sheetName", "address"],
      additionalProperties: false,
    },
  },
  {
    name: "et.insert_shape",
    description: "Insert a floating shape such as a text box, rectangle, arrow, line, or oval into a WPS Spreadsheet worksheet.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheetName: { type: "string" },
        bindingId: { type: "string" },
        projectId: { type: "string" },
        threadId: { type: "string" },
        address: { type: "string" },
        shapeType: { type: "string", enum: ["textBox", "rectangle", "arrow", "line", "oval"] },
        text: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        fillColor: { type: "string" },
        lineColor: { type: "string" }
      },
      required: ["sessionId", "sheetName", "address", "shapeType"],
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
    description: "Read text from the active WPS Writer document, with optional start/end offsets and revision view mode.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, maxLength: { type: "number" }, viewMode: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.select_range",
    description: "Select a character range or rangeId in the active WPS Writer document.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, rangeId: { type: "string" }, expectedText: { type: "string" }, failOnInexact: { type: "boolean" } },
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
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, startIndex: { type: "number" }, endIndex: { type: "number" }, rangeMode: { type: "string" }, maxCount: { type: "number" }, maxMs: { type: "number" }, lightweight: { type: "boolean" }, includeFormatSummary: { type: "boolean" }, fields: { type: "array", items: { type: "string" } } }, additionalProperties: false },
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
    description: "Find text in a WPS Writer document using native WPS Find by default and return reusable rangeIds.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, query: { type: "string" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" }, maxResults: { type: "number" }, viewMode: { type: "string" }, preferNormalized: { type: "boolean" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.replace_between_anchors",
    description: "Atomically replace the current visible text between two native WPS Writer text anchors.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, startAnchorText: { type: "string" }, endAnchorText: { type: "string" }, includeStart: { type: "boolean" }, includeEnd: { type: "boolean" }, occurrence: { type: ["string", "number"] }, index: { type: "number" }, endOccurrence: { type: ["string", "number"] }, endIndex: { type: "number" }, replacementText: { type: "string" }, verifyVisibleText: { type: "boolean" }, verifyMaxLength: { type: "number" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" }, viewMode: { type: "string" }, maxResults: { type: "number" } },
      required: ["startAnchorText", "endAnchorText", "replacementText"],
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
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, paragraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, format: paragraphFormatSchema, font: fontFormatSchema, dryRun: { type: "boolean" }, fastPath: { type: "boolean" }, preview: { type: "boolean" }, summaryOnly: { type: "boolean" }, includeText: { type: "boolean" }, includeRanges: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "wpp.copy_paragraph_format",
    description: "Copy paragraph formatting from one source paragraph to target paragraph indexes or a paragraph range without changing document text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceParagraphIndex: { type: "number" }, targetParagraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, includeFont: { type: "boolean" }, fields: { type: "array", items: { type: "string" } }, dryRun: { type: "boolean" }, preview: { type: "boolean" }, summaryOnly: { type: "boolean" }, includeText: { type: "boolean" }, includeRanges: { type: "boolean" } }, required: ["sourceParagraphIndex"], additionalProperties: false },
  },
  {
    name: "wpp.copy_selected_paragraph_format_to_indexes",
    description: "Copy paragraph formatting from the current selected paragraph to target paragraph indexes or a paragraph range without changing document text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, targetParagraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, includeFont: { type: "boolean" }, fields: { type: "array", items: { type: "string" } }, dryRun: { type: "boolean" }, preview: { type: "boolean" }, summaryOnly: { type: "boolean" }, includeText: { type: "boolean" }, includeRanges: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "wpp.compare_paragraph_format",
    description: "Compare paragraph formatting between a source paragraph and target paragraphs, returning per-target differing fields.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceParagraphIndex: { type: "number" }, targetParagraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, includeFont: { type: "boolean" }, fields: { type: "array", items: { type: "string" } }, summaryOnly: { type: "boolean" }, includeText: { type: "boolean" }, includeRanges: { type: "boolean" } }, required: ["sourceParagraphIndex"], additionalProperties: false },
  },

  {
    name: "wpp.list_tables",
    description: "List WPS Writer tables with 0-based table indexes for sync workflows.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, includeValues: { type: "boolean" }, maxTables: { type: "number" }, maxRows: { type: "number" }, maxColumns: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "wpp.apply_table_settings",
    description: "Apply the shared default batch table settings to selected WPS Writer tables and verify the changed table formats by reading them back.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        target: { type: "string", enum: ["All", "Selection", "tableIndexes", "ExceptSelection"] },
        tableIndexes: { type: "array", items: { type: "number" } },
        selectedTableIndex: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.select_table",
    description: "Select and reveal a WPS Writer table by 0-based tableIndex for table sync navigation.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.replace_table_values",
    description: "Replace WPS Writer table cell values while preserving existing table formatting where possible.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, values: matrixSchema, allowStructuralChanges: { type: "boolean" }, headerRowCount: { type: "number" }, syncHeader: { type: "boolean" } }, required: ["tableIndex", "values"], additionalProperties: false },
  },
  {
    name: "wpp.ensure_table_sync_anchor",
    description: "Return a stable sync anchor descriptor for a WPS Writer table. WPS currently uses table-index fallback anchors.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, anchorTag: { type: "string" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.resolve_table_sync_anchor",
    description: "Resolve a WPS Writer table sync anchor and optionally include table values.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, anchorTag: { type: "string" }, includeValues: { type: "boolean" } }, additionalProperties: false },
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
    name: "wpp.capture_table_format",
    description: "Capture the structured formatting of a selected or indexed WPS Writer table for reuse as a template. New template APIs use 0-based tableIndex.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        target: { type: "string", enum: ["Selection", "First", "tableIndex"] },
        tableIndex: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.save_table_format_template",
    description: "Capture a WPS Writer table format and save it as a reusable named template.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        target: { type: "string", enum: ["Selection", "First", "tableIndex"] },
        tableIndex: { type: "number" },
        name: { type: "string" },
        templateId: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.list_table_format_templates",
    description: "List saved WPS Writer table format templates.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "wpp.apply_table_format_template",
    description: "Apply a saved WPS Writer table format template to one or more document tables and verify the result by reading them back. Target indexes are 0-based.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        templateId: { type: "string" },
        target: { type: "string", enum: ["All", "Selection", "tableIndexes", "ExceptSelection"] },
        tableIndexes: { type: "array", items: { type: "number" } },
      },
      required: ["templateId"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.delete_table_format_template",
    description: "Delete a saved WPS Writer table format template.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string" } },
      required: ["templateId"],
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
      properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, border: { type: "boolean" }, alignment: { type: "string" }, headerRowBold: { type: "boolean" }, autofit: { type: "boolean" }, fitToWindow: { type: "boolean" }, fitToPageWidth: { type: "boolean" }, preferredWidthPercent: { type: "number" }, rowHeightRule: { type: ["string", "boolean"] }, textDirection: { type: "string" }, horizontalText: { type: "boolean" }, fontName: { type: "string" }, fontSize: { type: "number" }, cellPadding: { type: "object", additionalProperties: true } },
      additionalProperties: false,
    },
  },
  {
    name: "wpp.format_table_range",
    description: "Apply formatting to a rectangular range of WPS Writer table cells without changing text or structure.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, startRow: { type: "number" }, endRow: { type: "number" }, startCol: { type: "number" }, endCol: { type: "number" }, startColumn: { type: "number" }, endColumn: { type: "number" }, format: tableFormatSchema, dryRun: { type: "boolean" }, fastPath: { type: "boolean" }, includeResults: { type: "boolean" }, continueOnError: { type: "boolean" } }, required: ["tableIndex", "format"], additionalProperties: false },
  },
  {
    name: "wpp.format_table_rows",
    description: "Apply formatting to selected rows of a WPS Writer table, optionally limited to a column span.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, rows: { type: "array", items: { type: "number" } }, row: { type: "number" }, startCol: { type: "number" }, endCol: { type: "number" }, startColumn: { type: "number" }, endColumn: { type: "number" }, format: tableFormatSchema, dryRun: { type: "boolean" }, fastPath: { type: "boolean" }, includeResults: { type: "boolean" }, continueOnError: { type: "boolean" } }, required: ["tableIndex", "format"], additionalProperties: false },
  },
  {
    name: "wpp.format_table_columns",
    description: "Apply formatting to selected columns of a WPS Writer table, optionally limited to a row span.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, columns: { type: "array", items: { type: "number" } }, column: { type: "number" }, col: { type: "number" }, startRow: { type: "number" }, endRow: { type: "number" }, format: tableFormatSchema, dryRun: { type: "boolean" }, fastPath: { type: "boolean" }, includeResults: { type: "boolean" }, continueOnError: { type: "boolean" } }, required: ["tableIndex", "format"], additionalProperties: false },
  },
  {
    name: "wpp.read_table_format_sample",
    description: "Read only selected WPS Writer table cell style fields for fast format acceptance checks.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, cells: { type: "array", items: tableCellAddressSchema }, fields: tableFieldsSchema }, required: ["tableIndex", "cells"], additionalProperties: false },
  },
  {
    name: "wpp.read_table_format_range",
    description: "Read selected style fields from a rectangular WPS Writer table range without scanning heavy table metadata.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, startRow: { type: "number" }, endRow: { type: "number" }, startCol: { type: "number" }, endCol: { type: "number" }, startColumn: { type: "number" }, endColumn: { type: "number" }, fields: tableFieldsSchema }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_table_structure",
    description: "Read lightweight WPS Writer table structure, with optional merged cells, row heights, and column widths.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, includeMergedCells: { type: "boolean" }, includeRowHeights: { type: "boolean" }, includeColumnWidths: { type: "boolean" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_table_cell_styles",
    description: "Read selected WPS Writer table cell styles by explicit cells or by range; lightweight wrapper around sample/range readers.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, cells: { type: "array", items: tableCellAddressSchema }, startRow: { type: "number" }, endRow: { type: "number" }, startCol: { type: "number" }, endCol: { type: "number" }, fields: tableFieldsSchema }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.read_table_format",
    description: "Read complete WPS Writer table formatting, including table, cell, row height, column width, borders, padding, and merged-cell metadata.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, summaryOnly: { type: "boolean" }, cells: { type: "array", items: tableCellAddressSchema }, fields: tableFieldsSchema, startRow: { type: "number" }, endRow: { type: "number" }, startCol: { type: "number" }, endCol: { type: "number" }, startColumn: { type: "number" }, endColumn: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.apply_table_format",
    description: "Apply a structured table format object to a WPS Writer table without changing cell text.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, format: tableFormatSchema }, required: ["tableIndex", "format"], additionalProperties: false },
  },
  {
    name: "wpp.copy_table_style",
    description: "Copy safe table style from one WPS Writer table to another. Default scope copies border/font/headerShading/alignment but not column widths, row heights, merged cells, or text direction. Scope also supports table_only, cell_style, row_height, col_width, merged_cells, style_safe, or all.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceTableIndex: { type: "number" }, targetTableIndex: { type: "number" }, scope: { type: ["string", "array"], items: { type: "string" } } }, required: ["sourceTableIndex", "targetTableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.duplicate_table_appearance",
    description: "Make a target WPS Writer table look like a source table while keeping target content by default.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, sourceTableIndex: { type: "number" }, targetTableIndex: { type: "number" }, keepContent: { type: "boolean" } }, required: ["sourceTableIndex", "targetTableIndex"], additionalProperties: false },
  },
  {
    name: "wpp.insert_table_with_layout",
    description: "Insert a real WPS Writer table and immediately normalize page-width layout, horizontal text, auto row height, borders, font, header, padding, and optional column widths.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, rowCount: { type: "number" }, columnCount: { type: "number" }, values: matrixSchema, headerRowBold: { type: "boolean" }, border: { type: "boolean" }, fitToPageWidth: { type: "boolean" }, preferredWidthPercent: { type: "number" }, firstColumnWidth: { type: "number" }, equalDataColumnWidths: { type: "number" }, columnWidths: { type: "array", items: { type: "object", additionalProperties: true } }, columns: { type: "array", items: { type: "object", additionalProperties: true } }, fontName: { type: "string" }, fontSize: { type: "number" }, horizontalText: { type: "boolean" }, rowHeightRule: { type: "string" }, cellPadding: { type: "object", additionalProperties: true }, alignment: { type: "string" }, disableAutoFitForWidths: { type: "boolean" }, widthTolerance: { type: "number" } }, required: ["rowCount", "columnCount"], additionalProperties: false },
  },
  {
    name: "wpp.reset_table_layout",
    description: "Reset a WPS Writer table layout after unsafe style copying: fit to page width, horizontal text, automatic row height, and optional cell padding.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, fitToPageWidth: { type: "boolean" }, preferredWidthPercent: { type: "number" }, horizontalText: { type: "boolean" }, rowHeightRule: { type: ["string", "boolean"] }, cellPadding: { type: "object", additionalProperties: true } }, required: ["tableIndex"], additionalProperties: false },
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
    description: "Set WPS Writer table column widths and read back actual widths; returns warnings if WPS AutoFit or host behavior overrides requested widths.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tableIndex: { type: "number" }, columnWidths: { type: "array", items: { type: "object", additionalProperties: true } }, columns: { type: "array", items: { type: "object", additionalProperties: true } }, disableAutoFit: { type: "boolean" }, tolerance: { type: "number" } }, required: ["tableIndex"], additionalProperties: false },
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
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, text: { type: "string" }, author: { type: "string" }, verify: { type: "boolean" }, allowInexact: { type: "boolean" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.add_comment_by_text",
    description: "Find one exact text occurrence and add a real WPS Writer comment atomically, with range verification.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, query: { type: "string" }, occurrence: { type: ["string", "number"] }, index: { type: "number" }, text: { type: "string" }, author: { type: "string" }, exact: { type: "boolean" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" }, maxResults: { type: "number" }, verify: { type: "boolean" }, allowInexact: { type: "boolean" } },
      required: ["query", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.add_comments_batch",
    description: "Add multiple real WPS Writer comments by text anchors, normally from document end to start to avoid anchor drift.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, mode: { type: "string" }, verify: { type: "boolean" }, continueOnError: { type: "boolean" }, items: { type: "array", items: { type: "object", properties: { query: { type: "string" }, occurrence: { type: ["string", "number"] }, index: { type: "number" }, text: { type: "string" }, author: { type: "string" }, matchCase: { type: "boolean" }, matchWholeWord: { type: "boolean" }, maxResults: { type: "number" } }, required: ["query", "text"], additionalProperties: false } } },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "wpp.read_comments",
    description: "Read comments from the active WPS Writer document.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, summaryOnly: { type: "boolean" }, sinceCommentId: { type: "string" } }, additionalProperties: false },
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
    inputSchema: { type: "object", properties: { sessionId: { type: "string" }, readbackVisibleText: { type: "boolean" }, checksum: { type: "boolean" }, maxLength: { type: "number" } }, additionalProperties: false },
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
      properties: { sessionId: { type: "string" }, start: { type: "number" }, end: { type: "number" }, paragraphIndexes: { type: "array", items: { type: "number" } }, startParagraphIndex: { type: "number" }, endParagraphIndex: { type: "number" }, format: paragraphFormatSchema, alignment: { type: "string" }, spaceBefore: { type: "number" }, spaceAfter: { type: "number" }, lineSpacing: { type: "number" }, lineSpacingRule: { type: ["string", "number"] }, lineSpacingValue: { type: "number" }, firstLineIndent: { type: "number" }, leftIndent: { type: "number" }, rightIndent: { type: "number" }, keepWithNext: { type: "boolean" }, pageBreakBefore: { type: "boolean" }, summaryOnly: { type: "boolean" }, includeText: { type: "boolean" }, includeRanges: { type: "boolean" } },
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

const bindingSelectorSchema = {
  projectId: { type: "string" },
  projectName: { type: "string" },
  projectPath: { type: "string" },
  threadId: { type: "string" },
  conversationId: { type: "string" },
  documentRole: { type: "string" },
  bindingId: { type: "string" },
  documentKey: { type: "string" },
  binding: { type: "object", additionalProperties: true }
};
for (const tool of tools) {
  if (!tool.inputSchema || tool.inputSchema.type !== "object") continue;
  tool.inputSchema.properties = { ...(tool.inputSchema.properties || {}), ...bindingSelectorSchema };
}
