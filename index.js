const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const OpenAI = require('openai');
require('console-stamp')(console, '[HH:MM:ss.l]');

const bodyParser = require('body-parser');
const { sleep } = require('openai/core');
const sqlite3 = require('sqlite3').verbose();

const http = require('http');
const socketIo = require('socket.io');

let run_id;
let project_id = 'de.danoeh.antennapod';
const configPath = path.join(__dirname, 'config.json');
let path_to_root_folder = 'UFMAP/';
let path_to_screenshots_default = '/screenshots/';
let path_to_maestro_heirarchy_default = '/maestro_heirarchy/';
let path_to_json_results_default = '/json_results/';
let path_to_flow_files_default = '/scripts/flow-click-index.yaml';
let path_to_continuous_flows_default = 'continuous-flow.yaml';
gpt_map_folder = 'UFMAP/';
gpt_map_file = '';
current_json = "";
let path_to_flow_files;
let path_to_screenshots;
list_of_elems_to_click = [];
list_of_pHashes = [];
next_to_process_element = "";

dotenv.config();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


async function orchestrator() {
    
    console.log("*********** Running step 0");
    // Step 0 
    // Start Maestro in continuous mode

    // Variable to hold the reference to the maestro process
    let maestroProcess;

    // Function to Start the Maestro in Continuous mode
    function startMaestroContinuous() {
        // Replace contents of the continuous-flow.yaml with the template of Flow-continuous-index.yaml
        fs.copyFile('Flow-continuous-index.yaml', 'continuous-flow.yaml', (err) => {
            if (err) {
                console.error('Error copying file:', err);
                return;
            }
            console.log('Flow-continuous-index.yaml copy completed. Starting Maestro -c');

            // Create a writeable stream for the log file
            const maestroLogStream = fs.createWriteStream('maestro_output.log', { flags: 'a' });

            // Spawn the maestro process
            maestroProcess = spawn('maestro', ['test', '-c', 'continuous-flow.yaml']);

            // Reroute stdout and stderr to the log file
            maestroProcess.stdout.pipe(maestroLogStream);
            maestroProcess.stderr.pipe(maestroLogStream);

            // Handling the close event
            maestroProcess.on('close', (code) => {
                maestroLogStream.write(`Maestro process exited with code ${code}\n`);
                maestroLogStream.end(); // Close the stream
            });
        });
    }
    // Start the Maestro in Continuous mode
    startMaestroContinuous();
    console.log("Started Maestro in Continuous mode.")

    console.log("*********** Running step 1");
    // Step 1   
    // Assign run ID and initialise the DB
    generateNewRunID();
    
    // Initialize SQLite database, create a table for this run's chat, fill in with the initial messages
    const db = new sqlite3.Database(':memory:', (err) => {
        if (err) {
            return console.error(err.message);
        }
        console.log('Connected to the in-memory SQlite database.');
    });

    let tableCreated = false;
    let tableFilled = false;

    console.log("*********** Creating Table");
    try {
        await createTable(db);
        tableCreated = true;
        console.log("Created table messages successfully");
        try {
            await fillTable(db); 
            tableFilled = true;
            console.log("Filled the table with the initial messages successfully");
        } catch (error) {
            console.error(`Error filling the table with messages)`, error);
        };
    } catch (error) {
        console.error(`Error creating the table messages)`, error);
    }

    if (tableFilled) {
        console.log("*********** Running step 2");
        // Step 2  
        // set initial path as "/0" and call the recursive function
        let currentPath = "/0"
    
        try {
            // Ensure the asynchronous operation is completed before moving on
            // starting level is 0, and starting image to analyse is antenna--1--1-boxed-clicks.png
            await askRecommendationClickAllRecommendedElements(currentPath, db);
        } catch (error) {
            console.error(`Error starting the recursive function askRecommendationClickAllRecommendedElements()`, error);
        }
    } else {
        console.log("Table filling failed. Step 2 will not be executed.");
    }


    console.log("*********** Running step 3")
    // Step 3
    // Cleanup

    if (maestroProcess) {
        maestroProcess.kill('SIGTERM'); // Or another appropriate signal
        console.log('Stopped Maestro -c successfully');
        fs.unlink(path_to_continuous_flow, (err) => {
            if (err) {
                console.error(`Error: Unable to delete the file ${path_to_continuous_flow} with error: ${err.message}`);
            } else {
                console.log(path_to_continuous_flow, ' was deleted successfully');
            }
        });
    }
}

orchestrator();

// ++++++++++ functions ++++++++++

async function askRecommendationClickAllRecommendedElements(path_to_level, db) {
    console.log("askRecommendationClickAllRecommendedElements", path_to_level);
    // create folder structure
    try {   
        setEnvPath(path_to_level);
        await runPython(["init.py"]); // Use await to ensure completion
        console.log("Completed Init.py - the folders are created!")

        // create MAP folder for final map
        gpt_map_folder = "UFMAP/" + run_id + "/GPT_MAP";
        // Check if the directory already exists
        if (!fs.existsSync(gpt_map_folder)) {
            fs.mkdir(gpt_map_folder, (error) => {
                if (error) {
                    console.error('Error creating directory:', error);
                } else {
                    console.log('Directory created successfully:', gpt_map_folder);
                }
            });
        } else {
            console.log('Directory already exists:', gpt_map_folder);
        }
    } catch (error) {
        console.error(`Error during init:`, error);
    }

    // form maestro script, run maestro script, snap&plot path (if clickables exist)
    try {
        await runPython(["clickAndExtract.py", path_to_level]); // Use await here as well
        console.log("Completed clickAndExtract.py with ", path_to_level)
    } catch (error) {
        console.error(`Error running clickAndExtract.py:`, error);
    }
      
    // locate the plotted image for processing with chat gpt
    let path_to_plotted_screenshot = ""
    try {
        path_to_plotted_screenshot = findBoxedClicksPng(path_to_screenshots, 'boxed-clicks.png');
        if (path_to_plotted_screenshot) {
          console.log(`File found: ${path_to_plotted_screenshot}`);
        } else {
          console.log('File not found.');
        }
    } catch (error) {
        console.error('An error occurred:', error);
    }
      
    // PYTHON pHash - perceptual hash to find out if the image has been received before.
    // using python because it is more reliable than JS 
    // Python will receive list of hashes, calculate img pHash, and if list_of_pHashes not empty compare with every from there, if not seen before, return this hash
    // the ptyhon code will return a text pHash value IF needed to add, and an empty string if not


    let hasNOTSeenBefore = false;
    let output = "";
    let hash_to_add = "";
    // Function call with async/await

    // add list_of_pHashes to env variables
    process.env.PHASH_LIST = JSON.stringify(list_of_pHashes);
    console.log("Calling pHash.py with ", list_of_pHashes, " \n and ", path_to_plotted_screenshot)
    try {
        output = await runPython(["pHash.py", path_to_plotted_screenshot]); // Use await here as well
        hash_to_add = output.trim();
        console.log("Completed pHash-Test.py with ", list_of_pHashes, " \n and ", path_to_plotted_screenshot)
        console.log("=== NEW SCREEN the hash is :", hash_to_add)
        if (hash_to_add != "") {
            hasNOTSeenBefore = true;

            // change this to sqllite
            list_of_pHashes.push(hash_to_add);
        } else {
            console.log("I have seen this image! ", path_to_plotted_screenshot)
        }
    } catch (error) {
        console.error(`Error running pHash.py:`, error);
    }

    // If we have seen this screen before ask to create a MAP, ok to recommend to click, but do not add the recommended to the list to click
    let gpt_response = ""
    try {
        gpt_response = await gptStep(path_to_plotted_screenshot, db);
        if (gpt_response) {
        console.log(`GPT RESPONSE IS: ${gpt_response}`);
        } else {
        console.log('GPT did not provide any response. Must be an ISSUE');
        }
    } catch (error) {
        console.error('An error occurred:', error);
    }
    // If GPT has seen this, and hash did not - still change the variable
    if (gpt_response == 'HAVE SEEN BEFORE') {
        hasNOTSeenBefore = false;
    }

    if (hasNOTSeenBefore) {
        // add recommended to the stack of elements to click
        try {
            addClickablePaths(path_to_level, gpt_response);
            if (list_of_elems_to_click) {
            console.log("Elements for future clicks have been added")

            } else {
            console.log('No more elements to click');
            }
        } catch (error) {
            console.error('An error occurred:', error);
        }
    }
    console.log("All Possible Clickable Elements are ", list_of_elems_to_click)

    // Form a map - if root, create it, if child - add to the map
    gpt_map_file = "UFMAP/" + run_id + "/GPT_MAP/aiuf_map.json";
    path_to_gpt_json = path_to_json_results + "gpt_response.json";
    
    // if this root - read from json file, add path (“0”), add “children”: [], save to the common file,
    if (path_to_level === "/0") {
        try {
            let current_json = await readJsonFromFile(path_to_gpt_json);

            // Modify JSON object
            current_json.path = path_to_level;
            const lastBoxedIndex = path_to_plotted_screenshot.lastIndexOf('-boxed-clicks.png');
            current_json.screen = path_to_plotted_screenshot.substring(0, lastBoxedIndex) + '.png';
            current_json.children = [];

            // Save to the file
            await writeJsonToMap(current_json); // Assuming you want to write to the same file

            // create app and start the server to serve the HTML content with images from the map
            const app = express();
            const server = http.createServer(app);
            const io = socketIo(server);

            // Serve static files from the aiuf directory
            app.use(express.static('.'));

            let currentImageData = []; // Store the image data in memory

            // Initialize current image data and set up file watch
            fs.readFile(gpt_map_file, (err, data) => {
            if (!err) {
                currentImageData = JSON.parse(data);
            }
            });

            fs.watch(gpt_map_file, (eventType, filename) => {
            if (eventType === 'change') {
                fs.readFile(gpt_map_file, (err, data) => {
                if (err) {
                    console.error('Failed to read file:', err);
                    return;
                }
                try {
                    currentImageData = JSON.parse(data);
                    io.emit('update', currentImageData); // Update all clients
                } catch (parseErr) {
                    console.error('Error parsing JSON:', parseErr);
                }
                });
            }
            });

            // Serve the current images on new connections
            io.on('connection', socket => {
            socket.emit('update', currentImageData);
            });

            app.get('/', (req, res) => {
            res.sendFile(__dirname + '/frontend/index.html');
            });

            const port = 3000;
            server.listen(port, () => {
            console.log(`Server running on port ${port}`);
            });
        } catch (error) {
            console.error('Failed to process JSON:', error);
        }
    } else {
        
        try {
            let current_json = await readJsonFromFile(path_to_gpt_json);

            // Modify JSON object
            current_json.path = path_to_level;
            const lastBoxedIndex = path_to_plotted_screenshot.lastIndexOf('-boxed-clicks.png');
            current_json.screen = path_to_plotted_screenshot.substring(0, lastBoxedIndex) + '.png';
            current_json.children = [];
            
            let current_map = await readJsonFromFile(gpt_map_file);

            const lastSlashIndex = path_to_level.lastIndexOf('/'); // Find the last index of "/"
            const parent_path = path_to_level.substring(0, lastSlashIndex); // Extract substring from start to the last "/"
            
            // find in map node with path == parent_path, and add to its chikdren the new current_json
            parent_node = findNodeByPath(current_map, parent_path);
            parent_node.children.push(current_json);
            // Save to the file
            await writeJsonToMap(current_map); // Assuming you want to write to the same file
        } catch (error) {
            console.error('Failed to process JSON:', error);
        }
    }  




    // take the last element from the top of the stack
    try {
        next_to_process_element = getNextToClick(list_of_elems_to_click);
        if (next_to_process_element) {
          console.log(`Next to process elements is : ${next_to_process_element}`);
        } else {
          console.log('No more elements to click');
        }
    } catch (error) {
        console.error('An error occurred:', error);
    }  
    
    //if stack to click is empty - finish askRecommendationClickAllRecommendedElements()
    if (!next_to_process_element) {
        console.log('No more elements to click. \nThe MAP has been completed. \nExiting the program...');
        return;
    }
    // otherwise call itself
    try {
        await askRecommendationClickAllRecommendedElements(next_to_process_element, db);
    } catch (error) {
        console.error(`Error starting the recursive function askRecommendationClickAllRecommendedElements()`, error);
    }  
    
}

async function createTable(db) {
    const createTableSQL = `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT, isUserMessage BOOLEAN, text TEXT)`;
    return new Promise((resolve, reject) => {
        db.run(createTableSQL, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function fillTable(db) {
    let sessionId = "0382943547";
    //let message_1 = "I would like to make an app map similar to site maps.\nI want to make it automatically.\nI want to analyze current screen of application using UI Automation and click on available buttons one by one, I will send you a screenshot a you need to tell me if this is a new screen or if you already saw this and the button only changed something on current screen.\nThink about how you will analyze the screenshots that I will show you, how can you label and categorise them, so it will be clear to you if this a same screen of app, so you do not need to compare pixel to pixels.\n";
    //let botResponse_1 = "Creating an automated app map, similar to site maps, for a mobile or web application using UI Automation is an intriguing idea. This process involves navigating through the app, capturing screenshots, and then analyzing these screenshots to determine if they represent a new screen or a modification of an existing one. Here's a general approach to accomplish this:\n1. Screen Capture and Button Interaction\n* UI Automation Tool: Use a tool or framework that can interact with the app's UI elements. This tool should be able to identify and click buttons, and capture screenshots after each interaction.\n* Sequential Interaction: Systematically click on each available button to navigate through the app. After each click, capture a screenshot.\n2. Analyzing Screenshots\n* Image Hashing: Instead of pixel-to-pixel comparison, use image hashing techniques like Average Hash (aHash), Perceptual Hash (pHash), or Difference Hash (dHash). These methods create a hash value for images that can be quickly compared to determine similarity.\n* Feature Detection: Employ feature detection algorithms (like SIFT, SURF, or ORB) to find key features in the images. If two images share a significant number of features, they're likely the same screen.\n3. Categorization and Labeling\n* Hash Mapping: Store the hash of each unique screen in a database or a mapping structure. When a new screenshot is captured, compute its hash and compare it with existing hashes.\n* Threshold for Similarity: Define a similarity threshold. If the new image's hash is within this threshold of an existing hash, consider it the same screen.\n* Labeling Screens: Assign unique labels or identifiers to each unique screen. You can use a combination of the app's navigation path and screen content to create these labels.\n4. Building the App Map\n* Graph Structure: Represent the app's navigation as a graph, where each node is a unique screen, and edges represent transitions triggered by button clicks.\n* Visualization: Use graph visualization tools to create a visual map of the app's structure.\nChallenges and Considerations\n* Dynamic Content: Handling screens with dynamic content (like loading indicators or live feeds) can be tricky, as they might appear different in each screenshot.\n* Screen Variations: Screens with minor variations (like pop-ups or tooltips) need special handling to avoid being misclassified as entirely new screens.\nImplementation\n";
    //botResponse_1 +="* Tools and Libraries: Utilize programming libraries for image processing (like OpenCV), and graph libraries (like NetworkX) for mapping and visualization.\n* Iterative Approach: Initially, manually verify the categorization to refine the similarity thresholds and improve the algorithm's accuracy.\nThis is a high-level approach, and the actual implementation would depend on the specific characteristics of the app you're analyzing, as well as the programming environment and tools you're using.\n";
    //let message_2 = "1. Structural Analysis: Layout Recognition: Analyze the layout structure of each screenshot. Key elements like navigation bars, button placements, and content areas often remain consistent within the same screen. Element Hierarchy: Utilize the UI Automation framework to understand the hierarchy of elements. This can help in identifying if the core structure of the page has changed. \n2. Content Analysis: Text Comparison: Compare text elements on the screens. If the majority of the text remains the same, it's likely the same screen with minor changes. Visual Elements: Identify unique visual elements (like logos, specific graphics) that are consistent within a single screen. \n3. Change Detection: Button Interaction Tracking: Keep a log of the buttons clicked and the resulting changes. This helps in understanding whether a button leads to a new screen or modifies the current one. Dynamic Content Identification: Some screens might have dynamic content (like a news feed) which changes content but not the screen itself. \n4. Hashing and Fingerprinting: Image Hashing: Create a hash of the screenshots. If two hashes are identical or very similar, it's likely the same screen. This method is more reliable than pixel-to-pixel comparison and faster. Feature Extraction: Extract key features from the screenshots using image processing techniques and compare these features to distinguish between screens. \nCan you use #1, #2, #3, #4 ? I will be uploading screenshots one by one and you will analyze them and save the analysis in this chat in json format.\n if you see similar or identical screenshots only return \"HAVE SEEN THIS BEFORE\". ";
    //let botResponse_2 = "Absolutely, we can use the methods you've outlined (#1 Structural Analysis, #2 Content Analysis, #3 Change Detection, #4 Hashing and Fingerprinting) to analyze the screenshots you provide. This structured approach will enable us to efficiently categorize and differentiate between the screens of your application.\nHere's how we'll proceed:\n1. For Each Screenshot You Upload:\n* I'll analyze it based on the four methods you've described.\n* The analysis will focus on layout structure, element hierarchy, text and visual content, button interactions, dynamic content, and image hashing/fingerprinting.\n2. Saving Analysis in JSON Format:\n* After analyzing each screenshot, I'll provide a detailed JSON output summarizing the findings.\n* This JSON will include information about the layout, content, any detected changes, and hash/fingerprint data.\n3. Ongoing Process:\n* As you upload more screenshots, I'll continue to analyze them in the context of previous screens to understand the navigation flow and screen changes.\nPlease start by uploading the first screenshot, and I'll begin the analysis based on the methodologies you've provided.";
    
    // Path to the text file
    const filePath = path.join(__dirname, 'gpt_query.txt');
    console.log(filePath);
    message_1 = "";

    
    await readFileContent(filePath)
        .then(content => {
            message_1 = content;
            console.log('File content:', content);
        })
        .catch(error => {
            console.error('Failed to read file:', error);
        });
    
    const queries = [
        { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, true, message_1] },
       // { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, false, botResponse_1] },
       // { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, true, message_2] },
       // { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, false, botResponse_2] },
       // { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, true, message_3] },
    ];

    for (const q of queries) {
        try {
            await new Promise((resolve, reject) => {
                db.run(q.query, q.params, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            console.error('An error occurred:', error);
            throw error; // Optionally halt the process or handle the error as needed
        }
    }
};

// function to combine the array from GPT with the array of paths to explore 
function addClickablePaths(path_to_level, gpt_response){
    const responseArray = JSON.parse(gpt_response);
    if (responseArray.length > 0) {
        responseArray.forEach(element => {
            // one by one create a next level path for clicking 
            const elem_path = path_to_level + "/" + element;
            // add to the start of the list of paths
            list_of_elems_to_click.unshift(elem_path);
            // console.log("inaddClickablePaths: List of elements to click is : ", list_of_elems_to_click)
          });
    } else {
        console.log("GPT did not recommend any elements to click")
    }
}

// fun to find the plotted png in the current level
function findBoxedClicksPng(directory, suffix) {
        const files = fs.readdirSync(directory);
      
        // Find the file that ends with the specified suffix
        const file = files.find(f => f.endsWith(suffix));
        
        if (file) {
          return path.join(directory, file);
        } else {
          return null; // Or throw an error if you prefer
        }
}

function getNextToClick(list_of_elems_to_click) {
    if (list_of_elems_to_click.length > 0) {
        const next_to_process_element = list_of_elems_to_click.pop();
        console.log('Going to process element:', next_to_process_element);
        return next_to_process_element;
      } else {
        console.log('There are no more elements to process - time to finish!');
        return '';
      }
}

// mocked function to ask GPT for analysis, map and suggestion of next steps
async function gptStep(path_to_plotted_screenshot, db) {
    // Retrieve all messages
    const messages = await new Promise((resolve, reject) => {
        db.all('SELECT isUserMessage, text FROM messages ORDER BY id', (err, rows) => {
            if (err) {
                console.error(err.message);
                reject(err);
                return;
            }
            resolve(rows.map((msg) => ({
                role: msg.isUserMessage ? 'user' : 'assistant',
                content: msg.text
            })));
        });
    });
    
    console.log("GPT working with ", path_to_plotted_screenshot)

    // Load the image as base64
    const imageAsBase64 = fs.readFileSync(path_to_plotted_screenshot, 'base64');

    // Construct the message for the current screenshot
    const screenshotMessage = {
        role: 'user',
        content: [
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/png;base64,${imageAsBase64}`
                }
            }
        ],
    };
    
    // Add the screenshot message to the array of messages
    messages.push(screenshotMessage);

    // Call the OpenAI API
    const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: messages,
        max_tokens: 1000
    });

    // Retrieve the meaningful response text 
    const gpt_response = response.choices[0].message.content;

    // Add the user request prompt and the response to the database table 

    sessionId = "0382943547";
    let user_msg = screenshotMessage;
    let botResp = gpt_response;

    const queries = [
        { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, true, user_msg] },
        { query: `INSERT INTO messages(sessionId, isUserMessage, text) VALUES(?, ?, ?)`, params: [sessionId, false, botResp] },
    ];

    for (const q of queries) {
        try {
            await new Promise((resolve, reject) => {
                db.run(q.query, q.params, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            console.error('An error occurred:', error);
            throw error; // Optionally halt the process or handle the error as needed
        }
    }

    // write the GPT response and JSON to files in the exact screen folder 
    gpt_response_file = path_to_json_results + "gpt_response.txt";
    gpt_response_json_file = path_to_json_results + "gpt_response.json";
    // write full answer to a file
    fs.writeFile(gpt_response_file, gpt_response, (err) => {
        if (err) throw err;
            console.log('The gpt response has been saved to a file!');
        });
    // extract JSON content only and write to a JSON file in the same folder
    const extractSubstring = (gpt_response) => {
        // Regular expression to match content between triple quotes
        const regex = /```json(.*?)```/s;
    
        // Apply the regex to the input string
        const match = gpt_response.match(regex);
    
        // Check if there is a match
        if (match) {
            // Return the content within the triple quotes
            return match[1];
        } else {
            // Return null or an appropriate message if no match is found
            return null;
        }
    };
    
    const gpt_json_response_str = extractSubstring(gpt_response).trim()
    const gpt_json_response = JSON.parse(gpt_json_response_str);
    let jsonStringified = '';

    try {
        jsonStringified = JSON.stringify(gpt_json_response, null, 2); // Pretty print JSON
        await fsp.writeFile(gpt_response_json_file, jsonStringified, 'utf8');
    } catch (error) {
        console.error('Error writing to file:', error);
        throw error;
    }
    
    // extract only a list of the recommended clicks 
    const extractButtons = (gpt_json_response_str) => {
        // Regular expression to match content between triple quotes
        const regex = /\"button_recommendation\": (.*?)\n/s;
    
        // Apply the regex to the input string
        const match = gpt_json_response_str.match(regex);
    
        // Check if there is a match
        if (match) {
            // Return the content within the triple quotes
            return match[1];
        } else {
            // Return null or an appropriate message if no match is found
            return null;
        }
    };
    const buttons_to_click = extractButtons(gpt_json_response_str);
    console.log("== BUTTONS TO CLICK AS STRING ", buttons_to_click)
    // IF the answer containt HAVE SEEN THIS BEFORE return this as string
    const upperCaseString = gpt_json_response_str.toUpperCase();
    const have_seen_before = upperCaseString.includes("HAVE SEEN BEFORE");
    if (have_seen_before){
        return 'HAVE SEEN BEFORE';
    } else {
        return buttons_to_click;
    };
}

function generateNewRunID(){
    run_id = Date.now();
    console.log("run_id", run_id);
}

function runPython(pythonArgs) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', pythonArgs);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${stdoutData}`);
            stdoutData += data;
        });

        pythonProcess.stderr.on('data', (data) => {
            stderrData += data;
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`stdout: ${stdoutData}`);
                resolve(stdoutData);
            } else {
                console.error(`stderr: ${stderrData}`);
                reject(stderrData);
            }
        });
    });
}

function setEnvPath(path_to_level){

    path_to_screenshots = path_to_root_folder + run_id + path_to_level + path_to_screenshots_default;
    path_to_maestro_heirarchy = path_to_root_folder + run_id + path_to_level + path_to_maestro_heirarchy_default;
    path_to_json_results = path_to_root_folder + run_id + path_to_level + path_to_json_results_default;
    path_to_flow_files = path_to_root_folder + run_id + path_to_level + path_to_flow_files_default; 
    path_to_continuous_flow = path_to_continuous_flows_default; 

    // Set the environment variables for the folders, project and run ID
    process.env.PATH_TO_SCREENSHOTS = path.resolve(__dirname, path_to_screenshots);
    process.env.PATH_TO_MAESTRO_HEIRARCHY = path.resolve(__dirname, path_to_maestro_heirarchy);
    process.env.PATH_TO_JSON_RESULTS = path.resolve(__dirname, path_to_json_results);
    process.env.PATH_TO_FLOW_FILES = path.resolve(__dirname, path_to_flow_files);
    process.env.PATH_TO_CONTINUOUS_FLOW = path.resolve(__dirname, path_to_continuous_flow);
    process.env.RUN_ID = run_id;
    process.env.PROJECT_ID = project_id;

}

function extractBracketedText(input) {
    const matches = input.match(/\[.*?\]/);
    if (matches) {
      return matches[0];
    } else {
      return '';
    }
}

async function readFileContent(filePath) {
    try {
        // Wait for the file to be read
        const data = await fsp.readFile(filePath, { encoding: 'utf-8' });
        return data; // Return the content of the file
    } catch (error) {
        console.error('Error reading the file:', error);
        throw error; // Propagate the error
    }
}

// Function to read JSON from a file
async function readJsonFromFile(json_path) {
    try {
        const data = await fsp.readFile(json_path, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading file:', err);
        throw err; // Proper error handling by re-throwing or handling the error here
    }
}


// Function to write JSON to a file
async function writeJsonToMap(json, mapPath = gpt_map_file) {
    try {
        const data = JSON.stringify(json, null, 2); // Pretty print JSON
        await fsp.writeFile(mapPath, data, 'utf8');
    } catch (error) {
        console.error('Error writing to file:', error);
        throw error;
    }
}

// Function to find a node by path in a JSON structure
function findNodeByPath(currentMap, path) {
    let queue = [currentMap]; // Start with the root node
    while (queue.length > 0) {
        let currentNode = queue.shift(); // Get the first node in the queue

        // Check if the currentNode has the path we are looking for
        if (currentNode.path === path) {
            return currentNode; // Return the found node
        }

        // If not found, add all children of the current node to the queue (if any)
        if (currentNode.children && currentNode.children.length > 0) {
            queue.push(...currentNode.children);
        }
    }

    return null; // Return null if no node with the given path is found
}