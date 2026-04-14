interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle {
  getFileHandle(
    name: string,
    options?: {
      create?: boolean;
    }
  ): Promise<FileSystemFileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface StorageManager {
  getDirectory?(): Promise<FileSystemDirectoryHandle>;
}
