import express, { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const app = express();
app.use(express.json());

// Clarity PPM Configuration
const CLARITY_CONFIG = {
  baseUrl: process.env.CLARITY_BASE_URL || 'https://your-clarity-server.com',
  username: process.env.CLARITY_USERNAME || '',
  password: process.env.CLARITY_PASSWORD || '',
};

// Clarity API Client
class ClarityClient {
  private sessionId: string | null = null;

  async authenticate() {
    try {
      const response = await axios.post(
        `${CLARITY_CONFIG.baseUrl}/api/authentication/login`,
        {
          username: CLARITY_CONFIG.username,
          password: CLARITY_CONFIG.password,
        }
      );
      this.sessionId = response.data.sessionId;
      return this.sessionId;
    } catch (error: any) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async getProjects() {
    if (!this.sessionId) await this.authenticate();
    
    const response = await axios.get(
      `${CLARITY_CONFIG.baseUrl}/api/project`,
      {
        headers: {
          'X-Session-ID': this.sessionId,
        },
      }
    );
    return response.data;
  }

  async getProjectById(projectId: string) {
    if (!this.sessionId) await this.authenticate();
    
    const response = await axios.get(
      `${CLARITY_CONFIG.baseUrl}/api/project/${projectId}`,
      {
        headers: {
          'X-Session-ID': this.sessionId,
        },
      }
    );
    return response.data;
  }

  async getTasks(projectId: string) {
    if (!this.sessionId) await this.authenticate();
    
    const response = await axios.get(
      `${CLARITY_CONFIG.baseUrl}/api/project/${projectId}/tasks`,
      {
        headers: {
          'X-Session-ID': this.sessionId,
        },
      }
    );
    return response.data;
  }

  async createTask(projectId: string, taskData: any) {
    if (!this.sessionId) await this.authenticate();
    
    const response = await axios.post(
      `${CLARITY_CONFIG.baseUrl}/api/project/${projectId}/tasks`,
      taskData,
      {
        headers: {
          'X-Session-ID': this.sessionId,
        },
      }
    );
    return response.data;
  }

  async updateTask(taskId: string, updates: any) {
    if (!this.sessionId) await this.authenticate();
    
    const response = await axios.put(
      `${CLARITY_CONFIG.baseUrl}/api/task/${taskId}`,
      updates,
      {
        headers: {
          'X-Session-ID': this.sessionId,
        },
      }
    );
    return response.data;
  }
}

const clarityClient = new ClarityClient();

// Health check endpoint (for Railway)
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Clarity PPM MCP API',
    timestamp: new Date().toISOString(),
  });
});

// API Endpoints
app.get('/api/projects', async (req: Request, res: Response) => {
  try {
    const projects = await clarityClient.getProjects();
    res.json({
      success: true,
      data: projects,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/projects/:id', async (req: Request, res: Response) => {
  try {
    const project = await clarityClient.getProjectById(req.params.id);
    res.json({
      success: true,
      data: project,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/projects/:id/tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await clarityClient.getTasks(req.params.id);
    res.json({
      success: true,
      data: tasks,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/api/projects/:id/tasks', async (req: Request, res: Response) => {
  try {
    const task = await clarityClient.createTask(req.params.id, req.body);
    res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.put('/api/tasks/:id', async (req: Request, res: Response) => {
  try {
    const task = await clarityClient.updateTask(req.params.id, req.body);
    res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// MCP endpoint for Claude
app.post('/mcp', async (req: Request, res: Response) => {
  const { method, params } = req.body;

  try {
    switch (method) {
      case 'list_projects':
        const projects = await clarityClient.getProjects();
        res.json({ success: true, data: projects });
        break;

      case 'get_project':
        const project = await clarityClient.getProjectById(params.projectId);
        res.json({ success: true, data: project });
        break;

      case 'get_tasks':
        const tasks = await clarityClient.getTasks(params.projectId);
        res.json({ success: true, data: tasks });
        break;

      case 'create_task':
        const newTask = await clarityClient.createTask(params.projectId, params.taskData);
        res.json({ success: true, data: newTask });
        break;

      case 'update_task':
        const updatedTask = await clarityClient.updateTask(params.taskId, params.updates);
        res.json({ success: true, data: updatedTask });
        break;

      default:
        res.status(400).json({ success: false, error: 'Unknown method' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Clarity PPM MCP API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/`);
  console.log(`📍 API docs: http://localhost:${PORT}/api/projects`);
});