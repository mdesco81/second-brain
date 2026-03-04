class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new ApiError(response.status, text);
  }
  return response.json();
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(path);
    return handleResponse<T>(res);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async delete<T>(path: string): Promise<T> {
    const res = await fetch(path, { method: "DELETE" });
    return handleResponse<T>(res);
  },

  async postFormData<T>(path: string, formData: FormData): Promise<T> {
    const res = await fetch(path, { method: "POST", body: formData });
    return handleResponse<T>(res);
  },

  async getText(path: string): Promise<string> {
    const res = await fetch(path);
    if (!res.ok) throw new ApiError(res.status, "Failed to fetch text");
    return res.text();
  },

  async postText<T>(path: string, text: string): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text,
    });
    return handleResponse<T>(res);
  },
};
