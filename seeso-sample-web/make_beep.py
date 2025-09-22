import numpy as np
import random
from scipy.io.wavfile import write
import os, re, json

# 저장 폴더
output_dir = os.path.join("public", "beeps")
os.makedirs(output_dir, exist_ok=True)

# 파라미터
sample_rate = 44100
freq = 1000
beep_duration = 0.4
num_beeps = 4
total_length = 45.0     # ✅ 전체 길이 45초
noise_level = 0.0005    # 소음 최소화
num_files = 1

# 기존 파일 번호 찾기
existing_files = [f for f in os.listdir(output_dir) if f.startswith("beep_") and f.endswith(".wav")]
numbers = []
for f in existing_files:
    m = re.match(r"beep_(\d+)\.wav", f)
    if m:
        numbers.append(int(m.group(1)))
start_index = max(numbers, default=0) + 1

# 삐음 파형
t = np.linspace(0, beep_duration, int(sample_rate * beep_duration), endpoint=False)
beep_wave = 0.5 * np.sin(2 * np.pi * freq * t)

for i in range(num_files):
    sequence = np.array([], dtype=np.float32)
    timestamps = []

    # 전체 간격 랜덤 분배
    total_beep_time = num_beeps * beep_duration
    total_gap_time = total_length - total_beep_time
    random_parts = [random.random() for _ in range(num_beeps + 1)]
    total_random = sum(random_parts)
    gaps = [g / total_random * total_gap_time for g in random_parts]

    # 앞 소음
    sequence = np.concatenate((
        sequence,
        np.random.normal(0, noise_level, int(sample_rate * gaps[0])).astype(np.float32)
    ))

    for j in range(num_beeps):
        current_time = len(sequence) / sample_rate
        timestamps.append(round(current_time, 2))

        # 삐음
        sequence = np.concatenate((sequence, beep_wave.astype(np.float32)))

        # 삐음 뒤 소음
        sequence = np.concatenate((
            sequence,
            np.random.normal(0, noise_level, int(sample_rate * gaps[j+1])).astype(np.float32)
        ))

    # 45초 정확히 맞춤
    target_samples = int(sample_rate * total_length)
    sequence = sequence[:target_samples]

    # 저장
    idx = start_index + i
    wav_path = os.path.join(output_dir, f"beep_{idx}.wav")
    json_path = os.path.join(output_dir, f"beep_{idx}.json")

    scaled = np.int16(sequence * 32767)
    write(wav_path, sample_rate, scaled)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"beeps": timestamps}, f, ensure_ascii=False, indent=2)

    print(f"✅ {wav_path} + {json_path} 생성 완료 (45초, 잔잔한 소음 포함)")

# file_count.json 업데이트
all_files = [f for f in os.listdir(output_dir) if f.startswith("beep_") and f.endswith(".wav")]
count = len(all_files)
count_path = os.path.join(output_dir, "file_count.json")
with open(count_path, "w", encoding="utf-8") as f:
    json.dump({"count": count}, f, ensure_ascii=False, indent=2)

print(f"📊 file_count.json 업데이트 완료 (총 {count}개)")
