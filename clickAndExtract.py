import subprocess
import sys, os, time
import json, re
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

# Function to extract element coordinates by clickID from clickable.json of the parent
def extractCoordsByClickID(element_clickID, json_parent_path):
    # Load the JSON file to get the coordinates for the rectangles
    click_json_parent_path = ""
    x_coord = 0
    y_coord = 0
    for filename in os.listdir(json_parent_path):
        if "clicks.json" in filename:
            click_json_parent_path = os.path.join(json_parent_path, filename)
            print(f"path to clickable JSON in parent path is {click_json_parent_path}")

    with open(click_json_parent_path, 'r') as json_file:
        json_elements = json.load(json_file)
        # Iterate through the elements to find the one with the matching clickID
        for element in json_elements:
            if element.get('clickID') == int(element_clickID):
                # Assuming the coordinates are stored under a key named 'coordinates'
                x_coord = round((element.get("x1") + element.get("x2")) / 2)
                y_coord = round((element.get("y1") + element.get("y2")) / 2)
                return [x_coord, y_coord]
        # Return None if no matching element is found
        return None

# Function to create JSON out of maestro heirarchy
def create_full_JSON(heirarchy_full_path, json_full_path):
    with open(heirarchy_full_path, 'r') as file:
        file_content = file.read()

    # Extract JSON objects using regular expression
    json_objects = re.findall(r'\{.*?\}', file_content, re.DOTALL)
    processed_elements = []

    # Exclude elements with these resource-id
    excluded_resource_ids = ['com.google.android']

    # Add consecutive clickID to JSON elements
    clickID = 0

    for json_obj in json_objects:
        json_obj += "}"
        try:
            data = json.loads(json_obj)
            resource_id = data['attributes'].get('resource-id', '')
            
            # Exclude elements with specific resource-ids
            if any(excluded_id in resource_id for excluded_id in excluded_resource_ids):
                continue

            if data.get('attributes', {}).get('clickable') == 'true':
                # Extracting required details
                description = data['attributes'].get('text', '') or data['attributes'].get('accessibilityText', '') or data['attributes'].get('hintText', '')
                bounds = data['attributes'].get('bounds', '')
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', bounds)) if bounds else (0, 0, 0, 0)

                element_info = {
                    'description': description,
                    'x1': x1,
                    'y1': y1,
                    'x2': x2,
                    'y2': y2,
                    'clickID': clickID
                }
                processed_elements.append(element_info)
                clickID += 1
        except json.JSONDecodeError:
            continue

    # Write the processed elements to a JSON file
    with open(json_full_path, 'w') as file:
        json.dump(processed_elements, file, indent=4)

# Function to recursively find clickable elements
def find_clickable_elements(element, path=[]):
    clickable_elements = []
    if isinstance(element, dict):
        if element.get('attributes', {}).get('clickable') == 'true' and 'com.google.android.inputmethod' not in element.get('attributes', {}).get('resource-id'):
            clickable_elements.append((path, element))

        for child in element.get('children', []):
            clickable_elements += find_clickable_elements(child, path + [element.get('name', 'unknown')])

    return clickable_elements

# Function to parse the bounds string
def parse_bounds(bounds_str):
    x1y1, x2y2 = bounds_str.split('][')
    x1, y1 = map(int, x1y1[1:].split(','))
    x2, y2 = map(int, x2y2[:-1].split(','))
    return x1, y1, x2, y2

# Function to check if two divs overlap
def do_divs_overlap(div1, div2):
    # Returns True if div1 overlaps with div2
    return not (div1['x2'] <= div2['x1'] or div1['x1'] >= div2['x2'] or
                div1['y2'] <= div2['y1'] or div1['y1'] >= div2['y2'])

# Function to create JSON with only clickable elements that are not overlapped 
def create_clickableJSON(heirarchy_full_path, click_json_full_path):
    with open(heirarchy_full_path, 'r') as file:
        file_content = file.read().split("\"attributes\" : { },", 1)
        json_from_file = "{\n" + file_content[1]
        # print(json_from_file)
        data = json.loads(json_from_file)

    # Find clickable elements
    clickable_elements = find_clickable_elements(data)

    # Extract bounds and depth information
    bounds_data = []
    for path, element in clickable_elements:
        bounds_str = element['attributes']['bounds']
        x1, y1, x2, y2 = parse_bounds(bounds_str)
        # print("Element path is " + str(path))
        depth = len(path)
        bounds_data.append({'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'depth': depth})

    # Generate color for each element based on depth
    max_depth = max([item['depth'] for item in bounds_data])
    colors = [plt.cm.Greys(1 - item['depth'] / max_depth) for item in bounds_data]

    # Reverse the depth for each element
    max_depth = max([item['depth'] for item in bounds_data])
    for item in bounds_data:
        item['depth'] = max_depth - item['depth'] + 1  # Inverting the depth

    # Prepare HTML and CSS for visualization
    html_content = "<html><head><style>"
    html_content += "div.clickable { position: absolute; border: 1px solid red; }"
    for i, (item, color) in enumerate(zip(bounds_data, colors)):
        rgba_color = f"rgba({int(color[0]*255)}, {int(color[1]*255)}, {int(color[2]*255)}, {color[3]})"
        html_content += f"div.clickable{i} {{ left: {item['x1']}px; top: {item['y1']}px; width: {item['x2'] - item['x1']}px; height: {item['y2'] - item['y1']}px; background-color: {rgba_color}; z-index: {item['depth']}; }}"
        # print("element with depth: " + str(item['depth']) + " and colour: " + rgba_color)
    html_content += "</style></head><body>"

    for i in range(len(bounds_data)):
        html_content += f"<div class='clickable clickable{i}'></div>"

    html_content += "</body></html>"

    # Save the HTML content to a file
    html_file_path = heirarchy_full_path + '.html'
    with open(html_file_path, 'w') as file:
        file.write(html_content)

    print(f"HTML file saved at: {html_file_path}")



    # Creating non-overlapped divs

    # Reverse the depth and sort by z-index (depth)
    bounds_data.sort(key=lambda x: x['depth'], reverse=True)

    # Identify top-level non-overlapped divs
    non_overlapped_divs = []
    for i, div in enumerate(bounds_data):
        overlapped = False
        for higher_z_div in bounds_data[:i]:
            if do_divs_overlap(div, higher_z_div):
                overlapped = True
                break
        if not overlapped:
            non_overlapped_divs.append(div)

    # Prepare HTML content for non-overlapped divs
    html_content = "<html><head><style>"
    for i, div in enumerate(non_overlapped_divs):
        html_content += f"div.non_overlapped{i} {{ position: absolute; left: {div['x1']}px; top: {div['y1']}px; width: {div['x2'] - div['x1']}px; height: {div['y2'] - div['y1']}px; border: 1px solid purple; z-index: {div['depth']}; }}"
    html_content += "</style></head><body>"

    for i in range(len(non_overlapped_divs)):
        html_content += f"<div class='non_overlapped{i}'></div>"

    html_content += "</body></html>"

    # Save the HTML content to a file
    output_html_file_path = heirarchy_full_path + '-non-overlap.html'
    with open(output_html_file_path, 'w') as file:
        file.write(html_content)

    # Output the path of the new HTML file
    print(f"Non-overlapped divs HTML file saved at: {output_html_file_path}")

    # Process bouds data for non-overlapped clickables to JSON

    processed_elements = []
    clickID = 1
    for div in non_overlapped_divs:
        # print(clickID)
        element_info = {
            'x1': div['x1'],
            'y1': div['y1'],
            'x2': div['x2'],
            'y2': div['y2'],
            'clickID' : clickID
            }
        processed_elements.append(element_info)
        clickID += 1

    # print(processed_elements)



    # Write the processed elements to a JSON file
    with open(click_json_full_path, 'w') as file:
        json.dump(processed_elements, file, indent=4)

# Function to draw bounding boxes with a clickable ID on the images from Clickable Non-Overlapped JSON
def plot_clickable_with_ID(screenshot_full_path, click_screenshot_full_path, click_json_full_path):

    # Load the JSON file to get the coordinates for the rectangles
    with open(click_json_full_path, 'r') as json_file:
        json_elements = json.load(json_file)

    # Optional: Load a font, adjust the path and size as needed
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 45)
    except IOError:
        font = ImageFont.load_default()

    # Extracting the bounds for all elements in the JSON list
    rectangles = [{'x1': element['x1'], 'y1': element['y1'], 'x2': element['x2'], 'y2': element['y2'], 'clickID': element['clickID']} for element in json_elements]

    # Load the image
    screenshot = Image.open(screenshot_full_path)

    # Initialize the drawing context with the image as background
    draw = ImageDraw.Draw(screenshot)

    # Draw rectangles on the image
    for rect in rectangles:
        # The rectangle should be a red outline, hence we use 'outline' parameter
        draw.rectangle([rect['x1'], rect['y1'], rect['x2'], rect['y2']], outline="red")
        # Draw the clickID
        text = str(rect['clickID'])
        text_position = ((rect['x1'] + 15), (rect['y1'] + 5))  # Adjust if you want the text to appear elsewhere within the box
        #draw.text(text_position, text, fill="red", font=font, stroke_width=1, stroke_fill="red")
        left, top, right, bottom = draw.textbbox(text_position, text, font=font)
        draw.rectangle((left-5, top-5, right+5, bottom+5), fill="white")
        draw.text(text_position, text, fill="red", font=font, stroke_width=1, stroke_fill="red")

    # Save the modified image
    screenshot.save(click_screenshot_full_path)

# Polling for screenshot. When file found, means Maestro continuous have completed its current yaml
def poll_for_screenshot(screenshot_file_path, interval, timeout):
    start_time = time.time()
    while time.time() - start_time < timeout:
        if os.path.exists(screenshot_file_path):
            print(f"=== Screenshot found: ${screenshot_file_path}")
            return True
        time.sleep(interval)
    return False

# Prep 0. Extract Env variables 
path_to_screenshots = os.environ.get('PATH_TO_SCREENSHOTS', '/screenshots/')
path_to_maestro_heirarchy = os.environ.get('PATH_TO_MAESTRO_HEIRARCHY', '/maestro_heirarchy/')
path_to_results =  os.environ.get('PATH_TO_JSON_RESULTS', '/json_results')
path_to_flow_file = os.environ.get('PATH_TO_FLOW_FILES', '/scripts/flow-click-index.yaml')
continuous_flow_path = os.environ.get('PATH_TO_CONTINUOUS_FLOW', 'continuous-flow.yaml')
packageName = os.environ.get('PROJECT_ID', 'de.danoeh.antennapod')
run_id = os.environ.get('RUN_ID', '1711384851108')
new_file_contents = ""
# Prep 1. extract coordinates from the clicable JSON
x_coord = 0
y_coord = 0

# 1. find the file - if /0 then use the default
path_to_level = str(sys.argv[1])
path_to_parent = path_to_level.rsplit("/", 1)[0]

if path_to_level == "/0":
    x_coord = -1
    y_coord = -1
    path_to_parent_flow_file = "Flow-click-index.yaml"
else: 
    # take last number before "/" from the path_to_level 
    # read clickable json and find the coordinates of the element with clickID equal to the above
    element_clickID = path_to_level.rsplit("/", 1)[1]
    print(f"working with clickID {element_clickID}")
    json_parent_path = "UFMAP/" +  run_id + path_to_parent + "/json_results"
    coords = extractCoordsByClickID(element_clickID, json_parent_path)
    x_coord = coords[0]
    y_coord = coords[1]
    # construct the path_to_parent_flow_file
    path_to_parent_flow_file = "UFMAP/" +  run_id + path_to_parent + "/scripts/flow-click-index.yaml"

print(x_coord)
print(y_coord)
print(path_to_parent_flow_file)

# Prep 2. build names for output files 
screenshot_file_name = "antenna-" + str(x_coord) + "-" + str(y_coord) + ".png"
screenshot_with_box_file_name = "antenna-" + str(x_coord) + "-" + str(y_coord) + "-boxed-clicks.png"
maestro_heirarchy_file_name = "antenna-" + str(x_coord) + "-" + str(y_coord) + ".maestro_heirarchy"
json_file_name = "antenna-" + str(x_coord) + "-" + str(y_coord) + ".json"
click_json_file_name = "antenna-" + str(x_coord) + "-" + str(y_coord) + "-clicks.json"


# Prep 4. Form full paths for output files
screenshots_full_path = os.path.join(path_to_screenshots, screenshot_file_name)
click_screenshots_full_path = os.path.join(path_to_screenshots, screenshot_with_box_file_name)
maestro_heirarchy_full_path = os.path.join(path_to_maestro_heirarchy, maestro_heirarchy_file_name)
json_full_path = os.path.join(path_to_results, json_file_name)  
click_json_full_path = os.path.join(path_to_results, click_json_file_name)  

# Exec 1. stop and start the app
subprocess.run(f"adb shell am force-stop {packageName} && adb shell monkey -p {packageName} -c android.intent.category.LAUNCHER 1 && sleep 5", shell=True)

# Exec 2. prepare for clicking by keeping Maestro YAML in memory
with open(path_to_parent_flow_file, 'r') as file:
        file_contents = file.read()

# Exec 3. create a point from the received coordinates, click on the pooint and save screenshot and Maestro Heirarchy
click_position = [x_coord, y_coord]
print("Clicking on position " + str(click_position[0]) + ", " + str(click_position[1]))

# Create Maestro content
if x_coord == -1:
    new_file_contents = file_contents + "\n- takeScreenshot: " + screenshots_full_path[:-4]
else:
    new_file_contents = file_contents.split("- takeScreenshot:", 1)[0]
    # print(new_file_contents)
    new_file_contents += "\n- tapOn: \n    point: " + str(click_position)[1:-1] + \
                     "\n    waitToSettleTimeoutMs: 1000 \n\n- takeScreenshot: " + \
                     screenshots_full_path[:-4]

new_yaml_path = path_to_flow_file
 
# Write the modified contents to the new file
with open(new_yaml_path, 'w') as file:
    file.write(new_file_contents)
# print(f"maestro content written to {new_yaml_path}")

# write the same content to the continuous-flow.yaml to trigger the continuous maestro
with open(continuous_flow_path, 'w') as file:
    file.write(new_file_contents)
# print(f"maestro content written to {continuous_flow_path}")

# Check if the maestro continuous script ran successfully - poll for the presence of the screenshot
poll_interval = 0.1
timeout = 60
maestro_success = poll_for_screenshot(screenshots_full_path, poll_interval, timeout)

if maestro_success:
    result_maestro_heriarchy = subprocess.run(f"maestro hierarchy > {maestro_heirarchy_full_path}", shell=True)
    create_full_JSON(maestro_heirarchy_full_path, json_full_path)     
    create_clickableJSON(maestro_heirarchy_full_path, click_json_full_path)       
    plot_clickable_with_ID(screenshots_full_path, click_screenshots_full_path, click_json_full_path)    
else:
    print("maestro script failed")