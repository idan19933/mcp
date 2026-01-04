import express from 'express';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// ============================================================================
// TYPES
// ============================================================================

interface PendingRequest {
  id: string | number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

// ============================================================================
// PERSISTENT MCP PROCESS (Keep alive!)
// ============================================================================

let mcpProcess: ChildProcess | null = null;
let requestQueue: PendingRequest[] = [];
let isReady = false;

function startMCPProcess() {
  const indexPath = path.join(__dirname, 'index.js');
  
  console.log('🔄 Starting persistent MCP process...');
  
  mcpProcess = spawn('node', [indexPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let buffer = '';

  mcpProcess.stdout?.on('data', (data) => {
    buffer += data.toString();
    
    // Process complete JSON-RPC messages
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        
        // Find matching request in queue
        const index = requestQueue.findIndex(req => req.id === response.id);
        if (index !== -1) {
          const request = requestQueue.splice(index, 1)[0];
          request.resolve(response);
        }
      } catch (e) {
        // Not JSON, might be log line
        console.log('[MCP]', line.trim());
      }
    }
  });

  mcpProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    console.log('[MCP]', msg);
    
    // Check if ready
    if (msg.includes('Server Running') || msg.includes('Connected')) {
      isReady = true;
    }
  });

  mcpProcess.on('close', (code) => {
    console.log(`❌ MCP process exited with code ${code}`);
    isReady = false;
    
    // Reject all pending requests
    requestQueue.forEach(req => {
      req.reject(new Error('MCP process died'));
    });
    requestQueue = [];
    
    // Restart after 1 second
    setTimeout(startMCPProcess, 1000);
  });

  mcpProcess.on('error', (error) => {
    console.error('❌ MCP process error:', error);
  });
}

// Send request to persistent MCP process
function sendToMCP(request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!mcpProcess || !isReady) {
      return reject(new Error('MCP not ready'));
    }

    // Add to queue
    requestQueue.push({ id: request.id, resolve, reject });
    
    // Send request
    try {
      mcpProcess.stdin?.write(JSON.stringify(request) + '\n');
    } catch (error) {
      // Remove from queue on error
      const index = requestQueue.findIndex(req => req.id === request.id);
      if (index !== -1) requestQueue.splice(index, 1);
      reject(error);
    }
    
    // Timeout after 30 seconds
    setTimeout(() => {
      const index = requestQueue.findIndex(req => req.id === request.id);
      if (index !== -1) {
        requestQueue.splice(index, 1);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

// ============================================================================
// HTTP ENDPOINTS
// ============================================================================

app.post('/mcp', async (req, res) => {
  try {
    if (!isReady) {
      return res.status(503).json({ 
        error: 'MCP not ready', 
        message: 'Please wait for MCP to initialize' 
      });
    }

    const response = await sendToMCP(req.body);
    res.json(response);
  } catch (error: any) {
    console.error('Request error:', error.message);
    res.status(500).json({ 
      error: 'MCP request failed', 
      message: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: isReady ? 'ready' : 'initializing',
    timestamp: new Date().toISOString(),
    mcpPath: path.join(__dirname, 'index.js'),
    mode: 'Persistent Process',
    queueSize: requestQueue.length
  });
});

// ============================================================================
// STARTUP
// ============================================================================

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`🚀 MCP HTTP Server running on http://localhost:${PORT}`);
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Mode: Persistent MCP Process (Fast!)`);
  console.log('');
  
  // Start persistent MCP process
  startMCPProcess();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});