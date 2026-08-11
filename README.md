# 快点GPU比价

GPU 租赁价格对比网站。数据抓取自 [vast.ai](https://vast.ai) 公开定价接口，展示实时价格、价格/月、性价比星级，并提供 90 天价格趋势。

**核心功能**

- GPU 实时价格表（时价 / 月价）
- GPU 型号搜索
- 最便宜排序（`$`/hr）
- 性价比排行（VRAM-per-dollar，⭐1–5）
- 历史价格趋势图（90 天）

**技术栈**

- 后端：Go（标准库，无第三方依赖）
- 前端：原生 HTML/CSS/JS（无构建步骤）
- 数据源：`https://storage.googleapis.com/vast-public-gpu-pricing/gpu-pricing-public.json`

---

## 手动运行

### 环境要求

- Go 1.26+（低于 1.26 请修改 `go.mod` 中的版本号）

### 直接运行

```bash
go run .
```

启动后访问 <http://localhost:8080>。

### 常用参数

```bash
go run . -addr :9000              # 修改监听端口（默认 :8080）
go run . -cache ./data/gpu.json   # 自定义缓存文件路径（默认 data/gpu-pricing.json）
```

首次启动会联网抓取数据并写入缓存；之后重启时即使断网也会先加载磁盘缓存，并在后台,每小时更新一次。

### 构建二进制

```bash
go build -o gpuprice .
./gpuprice -addr :8080
```

---

## Docker 运行

### 环境要求

- Docker（任意支持 multi-stage build 的版本）

### 构建镜像

```bash
docker build -t gpuprice .
```

### 运行

```bash
docker run -d --name gpuprice \
  -p 8080:8080 \
  -v gpuprice-data:/data \
  gpuprice
```

- `-p 8080:8080`：宿主机 8080 端口映射到容器 8080
- `-v gpuprice-data:/data`：把磁盘缓存持久化到命名卷，重启不丢数据、断网可启动
- 访问 <http://localhost:8080>

### 修改端口

```bash
docker run -d --name gpuprice -p 9000:8080 gpuprice   # 宿主机 9000 端口
```

### 常用命令

```bash
docker logs gpuprice          # 查看日志
docker stop gpuprice          # 停止
docker start gpuprice         # 启动
docker rm gpuprice            # 删除容器
```

> 说明：容器内以非 root 用户 `appuser` 运行，仅对 `/data` 目录有写权限。

---

## 项目结构

```
.
├── Dockerfile            # 多阶段构建
├── go.mod
├── main.go               # HTTP 服务 + /api/gpus API
├── pricing/              # 数据抓取、缓存、价格/星级计算
│   ├── models.go
│   ├── service.go
│   └── util.go
├── static/               # 前端页面（嵌入二进制）
│   ├── index.html
│   ├── style.css
│   └── app.js
└── data/                 # 运行期生成的缓存文件
```

## 数据说明

- 价格：取自 vast.ai 公开数据（每小时更新一次）
- 月价 = 时价 × 730 小时
- 星级：按 `VRAM(GB) / 时价` 在全部在售 GPU 中做百分位排名（前 20% 为 5 星）
- 数据使用需遵循 vast.ai 许可条款（页面已附出处链接）
