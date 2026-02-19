Import("env") # type: ignore
import os
import shutil
import json

project_dir = env.subst("$PROJECT_DIR") # type: ignore
build_dir = env.subst("$BUILD_DIR") # type: ignore

# Set variables for easier access
common_data_dir = os.path.join(project_dir, "data")
merged_data_dir = os.path.join(build_dir, "merged_fs")
target_config_file = env.GetProjectOption("custom_config_file", "config.json") # type: ignore

# Update PlatformIO to use the merged directory
# This tells PIO to build the LittleFS image from 'merged_fs' instead of 'data'
env.Replace(PROJECT_DATA_DIR=merged_data_dir) # type: ignore

def minify_json(src, dst):
    """Reads a JSON file and writes a minified version to dst."""
    try:
        with open(src, 'r') as f:
            data = json.load(f)
        with open(dst, 'w') as f:
            # separators=(',', ':') removes whitespace after separators
            json.dump(data, f, separators=(',', ':'))
        print(f"  Minified: {os.path.basename(src)}")
    except Exception as e:
        print(f"  WARNING: Failed to minify {src}, copying raw. Error: {e}")
        shutil.copy2(src, dst)

def should_ignore(filename):
    """Returns True if the file should be excluded from the filesystem."""
    if filename.startswith("."): return True  # .DS_Store, .gitignore
    if filename.endswith(".example"): return True
    if filename.endswith(".example.json"): return True
    return False

def process_directory(src_dir, dst_dir):
    """Recursively copies files, minifying JSON and filtering junk."""
    if not os.path.exists(src_dir):
        return
    for root, dirs, files in os.walk(src_dir):
        rel_path = os.path.relpath(root, src_dir)
        target_root = os.path.join(dst_dir, rel_path)
        if not os.path.exists(target_root):
            os.makedirs(target_root)
        for file in files:
            if should_ignore(file):
                continue
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_root, file)
            if file.endswith(".json"):
                minify_json(src_file, dst_file)
            else:
                shutil.copy2(src_file, dst_file)

print(f"--- Merging & Optimizing filesystem for {env['PIOENV']} ---") # type: ignore

# Clean the staging directory
if os.path.exists(merged_data_dir):
    try:
        shutil.rmtree(merged_data_dir)
    except Exception:
        pass # Ignore locking errors
if not os.path.exists(merged_data_dir):
    os.makedirs(merged_data_dir)

# Process the common data directory
if os.path.exists(common_data_dir):
    process_directory(common_data_dir, merged_data_dir)

# Process the target config file
src_config = os.path.join(project_dir, target_config_file)
dst_config = os.path.join(merged_data_dir, target_config_file)
if os.path.exists(src_config):
    # Ensure parent dir exists (if config is in a subdir)
    os.makedirs(os.path.dirname(dst_config), exist_ok=True)
    if src_config.endswith(".json"):
        minify_json(src_config, dst_config)
    else:
        shutil.copy2(src_config, dst_config)
        print(f"  Copied: {target_config_file}")
else:
    print(f"WARNING: Config file '{src_config}' not found!")