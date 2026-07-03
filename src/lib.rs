use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct HeaderResult {
    pub has_error: bool,
    pub message: String,
    pub address_remote: String,
    pub port_remote: u16,
    pub raw_data_index: usize,
    pub is_udp: bool,
    pub version: u8,
}

#[wasm_bindgen(js_name = processVlessHeader)]
pub fn process_vless_header(chunk: &[u8], user_ids: &str) -> JsValue {
    let mut result = HeaderResult {
        has_error: true,
        message: "invalid data".to_string(),
        address_remote: String::new(),
        port_remote: 0,
        raw_data_index: 0,
        is_udp: false,
        version: 0,
    };

    if chunk.len() < 24 {
        return serde_wasm_bindgen::to_value(&result).unwrap();
    }

    let version = chunk[0];
    result.version = version;

    let mut uuid_bytes = [0u8; 16];
    uuid_bytes.copy_from_slice(&chunk[1..17]);
    
    let client_uuid = format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        uuid_bytes[0], uuid_bytes[1], uuid_bytes[2], uuid_bytes[3],
        uuid_bytes[4], uuid_bytes[5],
        uuid_bytes[6], uuid_bytes[7],
        uuid_bytes[8], uuid_bytes[9],
        uuid_bytes[10], uuid_bytes[11], uuid_bytes[12], uuid_bytes[13], uuid_bytes[14], uuid_bytes[15]
    );

    let valid = user_ids.split(',').any(|id| id.trim().to_lowercase() == client_uuid);
    if !valid {
        result.message = "invalid user".to_string();
        return serde_wasm_bindgen::to_value(&result).unwrap();
    }

    let opt_length = chunk[17] as usize;
    let command_index = 18 + opt_length;
    if chunk.len() <= command_index {
        return serde_wasm_bindgen::to_value(&result).unwrap();
    }

    let command = chunk[command_index];
    if command != 1 && command != 2 {
        result.message = format!("command {} is not supported", command);
        return serde_wasm_bindgen::to_value(&result).unwrap();
    }
    result.is_udp = command == 2;

    let port_index = command_index + 1;
    if chunk.len() < port_index + 3 {
        return serde_wasm_bindgen::to_value(&result).unwrap();
    }

    let port_remote = ((chunk[port_index] as u16) << 8) | (chunk[port_index + 1] as u16);
    result.port_remote = port_remote;

    let address_type = chunk[port_index + 2];
    let mut current_idx = port_index + 3;

    match address_type {
        1 => {
            if chunk.len() < current_idx + 4 {
                return serde_wasm_bindgen::to_value(&result).unwrap();
            }
            result.address_remote = format!(
                "{}.{}.{}.{}",
                chunk[current_idx], chunk[current_idx + 1], chunk[current_idx + 2], chunk[current_idx + 3]
            );
            current_idx += 4;
        }
        2 => {
            if chunk.len() < current_idx + 1 {
                return serde_wasm_bindgen::to_value(&result).unwrap();
            }
            let address_length = chunk[current_idx] as usize;
            current_idx += 1;
            if chunk.len() < current_idx + address_length {
                return serde_wasm_bindgen::to_value(&result).unwrap();
            }
            if let Ok(domain) = std::str::from_utf8(&chunk[current_idx..current_idx + address_length]) {
                result.address_remote = domain.to_string();
            } else {
                result.message = "invalid domain utf-8".to_string();
                return serde_wasm_bindgen::to_value(&result).unwrap();
            }
            current_idx += address_length;
        }
        3 => {
            if chunk.len() < current_idx + 16 {
                return serde_wasm_bindgen::to_value(&result).unwrap();
            }
            let mut segments = Vec::new();
            for i in 0..8 {
                let idx = current_idx + i * 2;
                let val = ((chunk[idx] as u16) << 8) | (chunk[idx + 1] as u16);
                segments.push(format!("{:x}", val));
            }
            result.address_remote = segments.join(":");
            current_idx += 16;
        }
        _ => {
            result.message = format!("invalid addressType: {}", address_type);
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
    }

    result.has_error = false;
    result.message = "success".to_string();
    result.raw_data_index = current_idx;

    serde_wasm_bindgen::to_value(&result).unwrap()
}
