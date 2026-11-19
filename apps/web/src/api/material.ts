import { get, post, patch, del, http } from './http';
import type { PageResult, MaterialRow, MaterialQuery, MaterialImportResult } from '@mes/shared';

export const listMaterials = (query: MaterialQuery) => get<PageResult<MaterialRow>>('/materials', query);

export const getMaterial = (id: number) => get<MaterialRow>(`/materials/${id}`);

export const createMaterial = (data: {
  code: string; name: string; spec?: string; categoryId: number; unitId: number;
  type: string; safetyStock?: number; status?: number;
}) => post<MaterialRow>('/materials', data);

export const updateMaterial = (id: number, data: {
  name?: string; spec?: string; categoryId?: number; unitId?: number;
  type?: string; safetyStock?: number; status?: number;
}) => patch<MaterialRow>(`/materials/${id}`, data);

export const deleteMaterial = (id: number) => del<void>(`/materials/${id}`);

/** 导入模板下载（走统一实例带 token，blob 响应） */
export const downloadImportTemplate = () =>
  http.get('/materials/import-template', { responseType: 'blob' });

/** 导入：multipart 上传；有错误时 HTTP 200，body 里 errors 非空 */
export const importMaterials = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return post<MaterialImportResult>('/materials/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // 大文件导入放宽超时
  });
};

/** 按筛选条件导出（blob 响应） */
export const exportMaterials = (query: MaterialQuery) =>
  http.get('/materials/export', { params: query, responseType: 'blob' });

/** 触发浏览器下载 blob */
export function saveBlobResponse(data: unknown, filename: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
