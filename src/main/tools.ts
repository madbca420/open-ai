/**
 * tools.ts — Native System Automation Tools & LLM Schemas
 *
 * Implements 7 desktop tools:
 *  1. open_application(name: string)       [Modifying]
 *  2. list_open_windows()                  [Read-Only]
 *  3. focus_window(title: string)          [Modifying]
 *  4. run_shell_command(command: string)   [Modifying - STRICT CONFIRMATION]
 *  5. read_clipboard()                     [Read-Only]
 *  6. write_clipboard(text: string)        [Modifying]
 *  7. take_screenshot()                    [Read-Only]
 */

import { clipboard, desktopCapturer } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logAudit } from './auditLog';

const execAsync = promisify(exec);

export interface ToolDefinition {
  name: string;
  description: string;
  isReadOnly: boolean;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: 'open_application',
    description: 'Launches or opens a desktop application or system utility by name or executable command.',
    isReadOnly: false,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or path of the application to open (e.g. "notepad", "calculator", "chrome", "ms-settings:").' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_open_windows',
    description: 'Lists all currently open desktop windows with their process IDs and window titles.',
    isReadOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'focus_window',
    description: 'Brings a specific open window to the foreground by matching its title.',
    isReadOnly: false,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title or partial title of the window to bring to focus.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'run_shell_command',
    description: 'Executes a PowerShell shell command on the user system. Requires explicit confirmation.',
    isReadOnly: false,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The exact PowerShell command string to execute.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_clipboard',
    description: 'Reads and returns the current plain text contents of the system clipboard.',
    isReadOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'write_clipboard',
    description: 'Copies text to the system clipboard.',
    isReadOnly: false,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text content to copy to the system clipboard.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'take_screenshot',
    description: 'Captures a full screenshot of the main desktop display and returns image data.',
    isReadOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Executes a tool implementation after confirmation checks pass.
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<{ success: boolean; result?: any; error?: string }> {
  logAudit(`TOOL_EXECUTE`, `Tool: ${name} | Args: ${JSON.stringify(args)}`, 'ATTEMPTED');

  try {
    let result: any;

    switch (name) {
      case 'open_application': {
        const appName = args.name;
        if (!appName) throw new Error('Application name is required.');
        // Use PowerShell Start-Process or cmd start
        const cmd = `start "" "${appName}"`;
        await execAsync(cmd, { shell: 'cmd.exe' });
        result = `Application "${appName}" launched successfully.`;
        break;
      }

      case 'list_open_windows': {
        const psScript = `Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json`;
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`);
        const parsed = JSON.parse(stdout || '[]');
        result = Array.isArray(parsed) ? parsed : [parsed];
        break;
      }

      case 'focus_window': {
        const title = args.title;
        if (!title) throw new Error('Window title is required.');
        const psScript = `$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate('${title.replace(/'/g, "''")}')`;
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`);
        result = `Attempted to focus window matching "${title}".`;
        break;
      }

      case 'run_shell_command': {
        const command = args.command;
        if (!command) throw new Error('Shell command is required.');
        const { stdout, stderr } = await execAsync(command, { shell: 'powershell.exe', timeout: 15000 });
        result = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
        break;
      }

      case 'read_clipboard': {
        const content = clipboard.readText();
        result = content || '(Clipboard is empty)';
        break;
      }

      case 'write_clipboard': {
        const text = args.text ?? '';
        clipboard.writeText(text);
        result = `Successfully wrote ${text.length} characters to clipboard.`;
        break;
      }

      case 'take_screenshot': {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1280, height: 720 },
        });

        if (sources.length === 0) {
          throw new Error('No screen display available for screenshot.');
        }

        const primarySource = sources[0];
        const dataUrl = primarySource.thumbnail.toDataURL(); // image/png base64
        result = {
          message: 'Screenshot captured successfully.',
          dataUrl,
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: "${name}"`);
    }

    logAudit(`TOOL_SUCCESS`, `Tool: ${name} | Output: ${typeof result === 'string' ? result : JSON.stringify(result).substring(0, 200)}`, 'EXECUTED');
    return { success: true, result };

  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logAudit(`TOOL_ERROR`, `Tool: ${name} | Error: ${errorMsg}`, 'FAILED');
    return { success: false, error: errorMsg };
  }
}

// ── Schemas for Provider LLM APIs ──

// Anthropic format
export function getAnthropicToolsSchema() {
  return SYSTEM_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: t.parameters.properties,
      required: t.parameters.required || [],
    },
  }));
}

// OpenAI format
export function getOpenAIToolsSchema() {
  return SYSTEM_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters.properties,
        required: t.parameters.required || [],
      },
    },
  }));
}

// Google Gemini format
export function getGoogleToolsSchema() {
  return [
    {
      functionDeclarations: SYSTEM_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters.properties,
          required: t.parameters.required || [],
        },
      })),
    },
  ];
}
