function normalizeContentRecord(content) {
  if (!content) return content;
  return {
    ...content,
    imageUrl: [content.imageUrl, content.image_url].find((url) => typeof url === 'string' && url.trim()) || '',
    videoUrl: [content.videoUrl, content.video_url].find((url) => typeof url === 'string' && url.trim()) || '',
    date: content.date ?? content.created_at,
    totalViews: content.totalViews ?? content.total_views ?? 0,
    taskLinks: content.taskLinks ?? content.task_links ?? []
  };
}

module.exports = { normalizeContentRecord };
