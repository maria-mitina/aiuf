import os

# Access the screenshot folder path from the environment variable
path_to_screenshots = os.environ.get('PATH_TO_SCREENSHOTS', 'output/screenshots/')
path_to_maestro_heirarchy = os.environ.get('PATH_TO_MAESTRO_HEIRARCHY', 'output/maestro_heirarchy/')
path_to_json_results = os.environ.get('PATH_TO_JSON_RESULTS', 'output/json_results')
path_to_flow_files = os.environ.get('PATH_TO_FLOW_FILES', 'output/scripts/Flow-files/Flow-click-index.yaml')


# Ensure the folders exist
if not os.path.exists(path_to_screenshots):
    print(f"The screenshot folder does not exist: {path_to_screenshots}. Making it...\n")
    os.makedirs(path_to_screenshots)
else:
    print(f"The screenshot folder exists: {path_to_screenshots}.")

if not os.path.exists(path_to_maestro_heirarchy):
    print(f"The folder with maestro heirarchy does not exist: {path_to_maestro_heirarchy}. Making it...\n")
    os.makedirs(path_to_maestro_heirarchy)
else:
    print(f"The folder with maestro heirarchy exists: {path_to_maestro_heirarchy}.\n")
    
if not os.path.exists(path_to_json_results):
    print(f"The json folder does not exist: {path_to_json_results}. Making it...\n")
    os.makedirs(path_to_json_results)
else:
    print(f"The json folder exists: {path_to_json_results}.\n")

if not os.path.exists(path_to_flow_files):
    print(f"The flow folder does not exist: {path_to_flow_files}. Making it...\n")
    os.makedirs(path_to_flow_files.rpartition("/")[0])
else:
    print(f"The flow folder exists: {path_to_flow_files}.\n")