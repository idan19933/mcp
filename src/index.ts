#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore
import sql from 'mssql';

// ============================================================================
// CONFIG: Connection Pooling for Speed
// ============================================================================
const DB_CONFIG = {
  user: 'niku',
  password: 'niku',
  server: '16.16.83.171',
  database: 'niku',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 20,
    min: 2, // Keep connections alive
    idleTimeoutMillis: 30000
  }
};

// ============================================================================
// GLOBAL POOL
// ============================================================================
let pool: sql.ConnectionPool | null = null;

async function getPool() {
  if (pool?.connected) return pool;
  try {
    pool = await new sql.ConnectionPool(DB_CONFIG).connect();
    console.error('✅ Database Connected (Pool Ready)');
    pool.on('error', (err: any) => console.error('Pool Error:', err));
    return pool;
  } catch (err) {
    console.error('❌ DB Connection Failed:', err);
    throw err;
  }
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================
const TOOLS: Tool[] = [
  {
    name: 'read_records',
    description: 'Read data from tables with WHERE filter',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        where: { type: 'object' },
        limit: { type: 'number' }
      },
      required: ['tableName', 'where', 'columns']
    }
  },
  {
    name: 'aggregate_query',
    description: 'Perform counts/sums/averages with grouping, sorting, and limits',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string' },
        aggregations: { type: 'array', items: { type: 'string' } },
        where: { type: 'object' },
        groupBy: { type: 'string' },
        orderBy: { type: 'string', description: 'ORDER BY clause, e.g., "total DESC"' },
        limit: { type: 'number', description: 'Number of rows to return' }
      },
      required: ['tableName', 'aggregations']
    }
  },
  {
    name: 'update_records',
    description: 'Update a single record by ID',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string' },
        data: { type: 'object' },
        idColumn: { type: 'string' },
        idValue: { type: 'string' }
      },
      required: ['tableName', 'data', 'idColumn', 'idValue']
    }
  },
  {
    name: 'bulk_update',
    description: 'Update multiple records with WHERE filter',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string' },
        data: { type: 'object' },
        where: { type: 'object' }
      },
      required: ['tableName', 'data', 'where']
    }
  },
  {
    name: 'find_project',
    description: 'Smart project finder - automatically tries PREXTERNALID and PRNAME',
    inputSchema: {
      type: 'object',
      properties: {
        searchValue: { 
          type: 'string',
          description: 'Project identifier to search (will try all fields automatically)'
        }
      },
      required: ['searchValue']
    }
  },
  {
    name: 'get_lookup_nsql',
    description: 'Get NSQL query text for a dynamic lookup by its display name',
    inputSchema: {
      type: 'object',
      properties: {
        lookupName: { 
          type: 'string',
          description: 'Display name of the lookup (e.g., "Active Numeric Lookups")'
        }
      },
      required: ['lookupName']
    }
  },
  {
    name: 'get_table_info',
    description: 'Get column names for a table',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: { type: 'string' }
      },
      required: ['tableName']
    }
  }
];

// ============================================================================
// HANDLERS
// ============================================================================

async function handleReadRecords(args: any) {
  const db = await getPool();
  const req = db.request();

  const cols = args.columns?.length ? args.columns.join(',') : '*';
  const limit = args.limit || 20;
  
  // Build WHERE clause with parameters
  const whereParts: string[] = [];
  if (args.where) {
    Object.entries(args.where).forEach(([key, val], idx) => {
      whereParts.push(`${key} = @p${idx}`);
      req.input(`p${idx}`, val);
    });
  }
  
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  
  // WITH(NOLOCK) is the secret to speed in Clarity
  const query = `SELECT TOP ${limit} ${cols} FROM ${args.tableName} WITH(NOLOCK) ${whereClause}`;
  
  console.error(`⚡ SQL: ${query}`);
  const result = await req.query(query);
  
  if (result.recordset.length === 0) {
    return `No records found in ${args.tableName}`;
  }
  
  return JSON.stringify(result.recordset, null, 2);
}

async function handleAggregateQuery(args: any) {
  const db = await getPool();
  const req = db.request();

  const aggs = args.aggregations.join(',');
  const whereParts: string[] = [];
  
  if (args.where) {
    Object.entries(args.where).forEach(([key, val], idx) => {
      whereParts.push(`${key} = @p${idx}`);
      req.input(`p${idx}`, val);
    });
  }
  
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupClause = args.groupBy ? `GROUP BY ${args.groupBy}` : '';
  const orderClause = args.orderBy ? `ORDER BY ${args.orderBy}` : '';
  const limitClause = args.limit ? `TOP ${args.limit}` : '';
  
  // SQL Server uses TOP at the beginning of SELECT
  const query = `SELECT ${limitClause} ${aggs} FROM ${args.tableName} WITH(NOLOCK) ${whereClause} ${groupClause} ${orderClause}`.replace(/\s+/g, ' ').trim();
  
  console.error(`⚡ SQL: ${query}`);
  const result = await req.query(query);
  
  return JSON.stringify(result.recordset, null, 2);
}

async function handleUpdateRecords(args: any) {
  const db = await getPool();
  const req = db.request();

  const updates: string[] = [];
  Object.entries(args.data).forEach(([key, val], idx) => {
    updates.push(`${key} = @u${idx}`);
    req.input(`u${idx}`, val);
  });

  req.input('idVal', args.idValue);
  
  const query = `UPDATE ${args.tableName} SET ${updates.join(', ')} WHERE ${args.idColumn} = @idVal`;
  
  console.error(`⚡ SQL: ${query}`);
  const result = await req.query(query);
  
  return `Updated ${result.rowsAffected[0]} record(s)`;
}

async function handleBulkUpdate(args: any) {
  const db = await getPool();
  const req = db.request();

  const updates: string[] = [];
  Object.entries(args.data).forEach(([key, val], idx) => {
    updates.push(`${key} = @u${idx}`);
    req.input(`u${idx}`, val);
  });

  const whereParts: string[] = [];
  Object.entries(args.where).forEach(([key, val], idx) => {
    whereParts.push(`${key} = @w${idx}`);
    req.input(`w${idx}`, val);
  });

  const query = `UPDATE ${args.tableName} SET ${updates.join(', ')} WHERE ${whereParts.join(' AND ')}`;
  
  console.error(`⚡ SQL: ${query}`);
  const result = await req.query(query);
  
  return `Bulk updated ${result.rowsAffected[0]} record(s)`;
}

async function handleFindProject(args: any) {
  const db = await getPool();
  const searchValue = args.searchValue || args.fieldValue; // Support both new and old format
  
  // Try multiple fields in order (removed CODE - doesn't exist in PRPROJECT)
  const fieldsToTry = ['PREXTERNALID', 'PRNAME'];
  
  for (const field of fieldsToTry) {
    try {
      const req = db.request();
      req.input('value', searchValue);
      
      const query = `SELECT TOP 1 PRID, PRNAME, PREXTERNALID FROM PRPROJECT WITH(NOLOCK) WHERE ${field} = @value`;
      
      console.error(`⚡ Trying ${field}: ${query}`);
      const result = await req.query(query);
      
      if (result.recordset.length > 0) {
        const project = result.recordset[0];
        console.error(`✅ Found via ${field}`);
        return `Found project: ${project.PRNAME} (External ID: ${project.PREXTERNALID}, Internal ID: ${project.PRID})`;
      }
    } catch (error: any) {
      console.error(`⚠️  ${field} search failed: ${error.message}`);
      continue; // Try next field
    }
  }
  
  // If nothing found, return helpful message
  return `No project found with identifier "${searchValue}". Tried searching in: PREXTERNALID, PRNAME.`;
}

async function handleGetLookupNSQL(args: any) {
  const db = await getPool();
  const req = db.request();
  
  req.input('lookupName', args.lookupName);
  
  const query = `
    SELECT 
      l.lookup_type AS lookup_id,
      cap.name AS lookup_name,
      q.nsql_text AS nsql_query
    FROM CMN_LOOKUP_TYPES l WITH(NOLOCK)
    JOIN CMN_CAPTIONS_NLS cap WITH(NOLOCK) ON l.id = cap.pk_id 
      AND cap.table_name = 'CMN_LOOKUP_TYPES' 
      AND cap.language_code = 'en'
    LEFT JOIN CMN_LIST_OF_VALUES lov WITH(NOLOCK) ON l.lookup_type = lov.lookup_type_code
    LEFT JOIN CMN_NSQL_QUERIES q WITH(NOLOCK) ON lov.sql_text_id = q.id
    WHERE 
      LOWER(cap.name) = LOWER(@lookupName)
      OR 
      LOWER(l.lookup_type) = LOWER(@lookupName)
  `;
  
  console.error(`⚡ SQL: ${query}`);
  const result = await req.query(query);
  
  if (result.recordset.length === 0) {
    return `No dynamic lookup found with name "${args.lookupName}". Try searching for partial name or check if it's a static lookup.`;
  }
  
  const lookup = result.recordset[0];
  
  if (!lookup.nsql_query) {
    return `Lookup "${lookup.lookup_name}" (ID: ${lookup.lookup_id}) exists but has no NSQL query. It might be a static lookup.`;
  }
  
  return `Lookup: ${lookup.lookup_name}\nID: ${lookup.lookup_id}\n\nNSQL Query:\n${lookup.nsql_query}`;
}

async function handleGetTableInfo(args: any) {
  const db = await getPool();
  const req = db.request();

  req.input('tableName', args.tableName);
  const query = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName`;
  
  const result = await req.query(query);
  const columns = result.recordset.map((row: any) => row.COLUMN_NAME);
  
  return columns.length ? `Columns: ${columns.join(', ')}` : 'Table not found';
}

// ============================================================================
// SERVER SETUP
// ============================================================================
const server = new Server(
  { name: 'clarity-fast-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let text = '';
    
    switch (name) {
      case 'read_records':
        text = await handleReadRecords(args);
        break;
      case 'aggregate_query':
        text = await handleAggregateQuery(args);
        break;
      case 'update_records':
        text = await handleUpdateRecords(args);
        break;
      case 'bulk_update':
        text = await handleBulkUpdate(args);
        break;
      case 'find_project':
        text = await handleFindProject(args);
        break;
      case 'get_lookup_nsql':
        text = await handleGetLookupNSQL(args);
        break;
      case 'get_table_info':
        text = await handleGetTableInfo(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text }]
    };

  } catch (error: any) {
    console.error(`❌ Error in ${name}:`, error.message);
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Clarity Fast MCP Server Running');
  console.error('   ⚡ Pool: min=2, max=20');
  console.error('   🔒 NOLOCK: Enabled');
}

main().catch(console.error);