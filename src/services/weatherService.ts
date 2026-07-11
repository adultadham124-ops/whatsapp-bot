const WTT_BASE = 'https://wttr.in';

export async function getWeather(location: string): Promise<string> {
  try {
    const res = await fetch(`${WTT_BASE}/${encodeURIComponent(location)}?format=%C+%t+%w+%h&lang=ar`);
    if (!res.ok) throw new Error('Weather fetch failed');
    const text = await res.text();
    return text.trim();
  } catch {
    return 'معرفتش أجيب حالة الطقس 😅';
  }
}

export async function getForecast(location: string): Promise<string> {
  try {
    const res = await fetch(`${WTT_BASE}/${encodeURIComponent(location)}?format=%C+|+%t+|+%w+|+%h&lang=ar&days=3`);
    if (!res.ok) throw new Error('Forecast fetch failed');
    const text = await res.text();
    return text.trim();
  } catch {
    return 'معرفتش أجيب التوقعات 😅';
  }
}
