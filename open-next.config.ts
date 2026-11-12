// 本项目页面全部是动态渲染，数据自带内存缓存，不需要 R2 增量缓存，使用默认配置即可。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
