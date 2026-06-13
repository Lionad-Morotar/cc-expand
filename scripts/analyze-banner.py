import cv2
import numpy as np
from sklearn.cluster import KMeans

img = cv2.imread('zRefs/banner.png')
img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
height, width = img_rgb.shape[:2]

print(f"尺寸: {width}x{height}")

# 亮度分布
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
print(f"亮度均值: {gray.mean():.1f}, 中位数: {np.median(gray):.1f}")

# 主色调
pixels = img_rgb.reshape(-1, 3).astype(np.float32)
kmeans = KMeans(n_clusters=5, random_state=42, n_init=10).fit(pixels)
colors = kmeans.cluster_centers_.astype(int)
counts = np.bincount(kmeans.labels_)
for c, count in zip(colors, counts):
    print(f"主色 #{c[0]:02x}{c[1]:02x}{c[2]:02x}: {count / len(pixels) * 100:.1f}%")

# 检测亮区中心
_, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
moments = cv2.moments(thresh)
cx = int(moments['m10'] / moments['m00'])
cy = int(moments['m01'] / moments['m00'])
print(f"最亮区域中心: ({cx}, {cy})")

# 检测门框大致位置（用边缘）
edges = cv2.Canny(gray, 50, 150)
lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100, minLineLength=100, maxLineGap=10)
print(f"检测到的直线数: {len(lines) if lines is not None else 0}")

# 保存边缘图供参考
cv2.imwrite('tmp/banner-edges.png', edges)
