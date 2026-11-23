// SPDX-License-Identifier: AGPL-3.0-only

use std::fmt::Write;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../../../db/migrations");
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").ok_or("missing CARGO_MANIFEST_DIR")?);
    let providers = manifest.join("src/integrations/music/providers");
    println!("cargo:rerun-if-changed={}", providers.display());

    let mut modules = Vec::new();
    for entry in std::fs::read_dir(providers)? {
        let path = entry?.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_stem().and_then(|value| value.to_str()).ok_or("invalid provider filename")?;
        if !name.starts_with(|ch: char| ch.is_ascii_lowercase())
            || !name.bytes().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'_')
        {
            return Err(format!("invalid music provider module filename: {name}").into());
        }
        modules.push((name.to_owned(), path));
    }
    modules.sort_unstable_by(|a, b| a.0.cmp(&b.0));

    let mut source = String::new();
    for (name, path) in &modules {
        writeln!(source, "#[path = {path:?}]\nmod {name};")?;
    }
    writeln!(source, "fn discover(context: &ProviderContext) -> Vec<Arc<dyn MusicProvider>> {{\n    vec![")?;
    for (name, _) in &modules {
        writeln!(source, "        {name}::register(context),")?;
    }
    writeln!(source, "    ]\n}}")?;

    let out = PathBuf::from(std::env::var_os("OUT_DIR").ok_or("missing OUT_DIR")?);
    std::fs::write(out.join("music_providers.rs"), source)?;
    Ok(())
}
