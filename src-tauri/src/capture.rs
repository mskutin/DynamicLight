use crate::{lighting, protocol::Rgb, settings::Settings};
use serde::Serialize;
use xcap::Monitor;
#[derive(Serialize)]
pub struct Screen {
    pub id: String,
    pub name: String,
}
pub fn screens() -> Result<Vec<Screen>, String> {
    Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| {
            Ok(Screen {
                id: m.id().map_err(|e| e.to_string())?.to_string(),
                name: format!(
                    "{} · {} × {}",
                    m.friendly_name().unwrap_or_else(|_| "Display".into()),
                    m.width().unwrap_or(0),
                    m.height().unwrap_or(0)
                ),
            })
        })
        .collect()
}
pub struct ScreenCapture {
    monitor: Monitor,
    pub dimensions: (u32, u32),
}
impl ScreenCapture {
    pub fn start(id: &str) -> Result<Self, String> {
        let all = Monitor::all().map_err(|e| e.to_string())?;
        let monitor = if id.is_empty() {
            all.iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .or(all.first())
        } else {
            all.iter()
                .find(|m| m.id().map(|v| v.to_string() == id).unwrap_or(false))
        }
        .ok_or("Selected display is unavailable. Refresh the display list.")?
        .clone();
        let image = monitor.capture_image().map_err(|e| {
            format!("Screen capture failed: {e}. Check screen recording permission.")
        })?;
        Ok(Self {
            monitor,
            dimensions: (image.width(), image.height()),
        })
    }
    pub fn colors(&mut self, settings: &Settings) -> Result<Vec<Rgb>, String> {
        let image = self.monitor.capture_image().map_err(|e| e.to_string())?;
        self.dimensions = (image.width(), image.height());
        Ok(lighting::sample(
            image.as_raw(),
            image.width(),
            image.height(),
            settings,
        ))
    }
}
