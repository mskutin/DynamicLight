use crate::engine::Handle;

pub struct FrameClock {
    active: bool,
}
#[cfg(target_os = "windows")]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: u32) -> u32;
    fn timeEndPeriod(period: u32) -> u32;
}
impl FrameClock {
    pub fn new() -> Self {
        Self { active: false }
    }
    pub fn set_active(&mut self, active: bool) {
        if self.active == active {
            return;
        }
        #[cfg(target_os = "windows")]
        unsafe {
            if active {
                timeBeginPeriod(1);
            } else {
                timeEndPeriod(1);
            }
        }
        self.active = active;
    }
}
impl Drop for FrameClock {
    fn drop(&mut self) {
        self.set_active(false);
    }
}

#[cfg(target_os = "windows")]
pub fn watch_power(handle: Handle) -> Result<(), String> {
    use std::ffi::c_void;
    #[repr(C)]
    struct Subscription {
        callback: unsafe extern "system" fn(*mut c_void, u32, *mut c_void) -> u32,
        context: *mut c_void,
    }
    #[link(name = "PowrProf")]
    extern "system" {
        fn PowerRegisterSuspendResumeNotification(
            flags: u32,
            recipient: *mut c_void,
            registration: *mut *mut c_void,
        ) -> u32;
    }
    unsafe extern "system" fn callback(context: *mut c_void, kind: u32, _: *mut c_void) -> u32 {
        // The OS owns this registration for the application's lifetime. The boxed
        // sender remains allocated until process exit, so callbacks cannot dangle.
        if kind == 4 || kind == 18 {
            (*(context as *const Handle)).power_event(kind == 4);
        }
        0
    }
    let context = Box::into_raw(Box::new(handle));
    let mut subscription = Subscription {
        callback,
        context: context.cast(),
    };
    let mut registration = std::ptr::null_mut();
    let code = unsafe {
        PowerRegisterSuspendResumeNotification(
            2,
            (&mut subscription as *mut Subscription).cast(),
            &mut registration,
        )
    };
    if code != 0 {
        unsafe {
            drop(Box::from_raw(context));
        }
        return Err(format!("Could not register sleep notifications ({code})"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::audio::Feed;
    use std::ffi::{c_char, c_void, CStr};
    extern "C" {
        fn dl_watch_power(callback: extern "C" fn(*mut c_void, bool), context: *mut c_void);
        fn dl_microphone_permission() -> bool;
        fn dl_audio_start(
            callback: extern "C" fn(*mut c_void, *const f32, usize),
            error: extern "C" fn(*mut c_void),
            context: *mut c_void,
            message: *mut c_char,
            length: usize,
        ) -> *mut c_void;
        fn dl_audio_stop(stream: *mut c_void) -> bool;
    }
    pub fn watch_power(handle: Handle) -> Result<(), String> {
        extern "C" fn callback(ctx: *mut c_void, sleep: bool) {
            unsafe {
                (*(ctx as *const Handle)).power_event(sleep);
            }
        }
        unsafe {
            dl_watch_power(callback, Box::into_raw(Box::new(handle)).cast());
        }
        Ok(())
    }
    pub fn microphone_permission() -> Result<(), String> {
        if unsafe { dl_microphone_permission() } {
            Ok(())
        } else {
            Err(
                "Allow DynamicLight microphone access in System Settings → Privacy & Security."
                    .into(),
            )
        }
    }
    pub struct MacAudio {
        stream: *mut c_void,
        context: *mut Feed,
    }
    impl MacAudio {
        pub fn start(feed: Feed) -> Result<Self, String> {
            extern "C" fn samples(ctx: *mut c_void, data: *const f32, len: usize) {
                // Native bridge delivers mono f32 samples valid for this callback.
                unsafe {
                    if let Ok(mut s) = (*(ctx as *const Feed)).try_lock() {
                        s.push(std::slice::from_raw_parts(data, len).iter().copied());
                    }
                }
            }
            extern "C" fn error(ctx: *mut c_void) {
                unsafe {
                    if let Ok(mut s) = (*(ctx as *const Feed)).lock() {
                        s.error =
                            Some("System audio capture stopped. Start capture to retry.".into());
                    }
                }
            }
            let context = Box::into_raw(Box::new(feed));
            let mut message = [0i8; 512];
            let stream = unsafe {
                dl_audio_start(
                    samples,
                    error,
                    context.cast(),
                    message.as_mut_ptr(),
                    message.len(),
                )
            };
            if stream.is_null() {
                unsafe {
                    drop(Box::from_raw(context));
                }
                return Err(unsafe { CStr::from_ptr(message.as_ptr()) }
                    .to_string_lossy()
                    .into_owned());
            }
            Ok(Self { stream, context })
        }
    }
    impl Drop for MacAudio {
        fn drop(&mut self) {
            // On a failed stop retain the callback context until process exit instead
            // of risking a late OS callback accessing freed memory.
            if unsafe { dl_audio_stop(self.stream) } {
                unsafe {
                    drop(Box::from_raw(self.context));
                }
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub use mac::*;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn watch_power(_: Handle) -> Result<(), String> {
    Err("Sleep notifications are supported on Windows and macOS".into())
}
