import sys, json, os
from PIL import Image
import imagehash

# Function to calculate the perceptual hash of an image
def calculate_perceptual_hash(image_path, hashfunc=imagehash.phash):
    with Image.open(image_path) as img:
        # Calculate the hash
        img_hash = hashfunc(img)
    return img_hash

# Function to compare two images for similarity
def are_images_similar(hash1, hash2, cutoff=13):
    # Check if the difference between hashes is below the cutoff
    return hash1 - hash2 < cutoff

# extract variables and arguments
screenshot_path = str(sys.argv[1])
string_of_pHashes = os.environ.get('PHASH_LIST', '')

list_of_pHashes = json.loads(string_of_pHashes)
# Calculate hashes for all images in the array
new_img_hash = calculate_perceptual_hash(screenshot_path)

# Compare hashes for similarity
hasNotSeenBefore = True
for img_hash_str in list_of_pHashes:
    # Convert the string back to an imagehash object
    img_hash = imagehash.hex_to_hash(img_hash_str)
    if are_images_similar(new_img_hash, img_hash):
        hasNotSeenBefore = False
        break

if hasNotSeenBefore:
    print(new_img_hash)