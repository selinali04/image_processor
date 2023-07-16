
const FileType = require('file-type');
const path = require('path');
const Image = require('image-js');
const sharp = require('sharp');
const fs = require('fs');

class Picture {
  constructor(pixels, mode, size, filename, format, components) {
    // Accepts mandatory parameters:
    // - pixels: pixel representation of the image in the form of a list
    // - mode: string describing the type + depth of the pixels in the image
    // - size: tuple (height, width)
    // - filename: filename of the original file
    // - format: file format or extension of the image
    // - components: number of values of each pixel (i.e. RGB has 3/pixel)

    this.pixels = pixels;
    this.mode = mode;
    this.width = size[0];
    this.height = size[1];
    this.filename = filename;
    this.format = format;
    this.components = components;
  }

  setPicName = (newName) => {
    // Setter for picture filename
    this.filename = newName;
  };

  blurFilter = (kernel) => {
    // Applies blur filter to kernel, creates and returns new Picture object.
    let blurredPixels = [];
    const center = Math.floor(kernel.length / 2);

    // Iterates through each pixel.
    this.pixels.forEach((row, i) => {
      blurredPixels[i] = [];
      row.forEach((pixel, j) => {
        pixel.forEach((component, k) => {
          // Skip Alpha channel if it exists
          if (k === 3 && this.colorModel === "RGBA"){
            return;
          }

          let sum = 0;

          // Apply the kernel to the surrounding pixels.
          for (let x = i - center; x <= i + center; x++) {
            for (let y = j - center; y <= j + center; y++) {
              try {
                // Multiply the kernel value with the corresponding pixel value, increment sum.
                sum += kernel[x + center][y + center] * this.pixels[x][y][k];
              } catch (error) {
                // if pixel does not exist do nothing
              }
            }
          }

          blurredPixels[i][j].push(sum);
      });
      });
    });

    // Create and return a new Picture object with the blurred pixels
    return new Picture(
      blurredPixels,
      this.mode,
      [this.width, this.height],
      this.filename + '_blurred',
      this.format,
      this.components
    );
  };

  roundAndClip = () => {
    this.pixels.forEach((row, i) => {
      row.forEach((pixel, j) => {
        pixel.forEach((component, k) => {
          // Round the pixel value to the nearest integer.
          let roundedValue = Math.round(component);
    
          // Clip the pixel value based on the color model.
          let clippedValue;
    
          if (['RGB', 'RGBA', 'GREY'].includes(this.mode)) {
            if (j === 3 && this.mode === "RGBA") {
              clippedValue = roundedValue;
            } else {
              // Clip the pixel value to the valid range of 0 to 255.
              clippedValue = Math.max(0, Math.min(roundedValue, 255));
            }
          } else if (this.mode === 'CMYK') {
            // Clip the pixel value to the valid range of 0 to 100.
            clippedValue = Math.max(0, Math.min(roundedValue, 100));
          } else if (['HSL', 'HSV'].includes(this.mode)) {
            // Round the pixel value to two decimal places.
            roundedValue = Math.round(value * 100) / 100;
    
            // Clip the pixel value to the valid range of 0 to 1.
            clippedValue = Math.max(0, Math.min(roundedValue, 1));
          } else if (this.mode === 'LAB') {
            if (j === 0) {
              // Clip the L* component to the valid range of 0 to 100.
              clippedValue = Math.max(0, Math.min(roundedValue, 100));
            } else {
              // Clip the a* and b* components to the valid range of -128 to 127.
              clippedValue = Math.max(-128, Math.min(roundedValue, 127));
            }
          }
    
          this.pixels[i][j][k] = clippedValue;
      });
    });
  });
  };
  

}

const fetchImages = (search) => {
  const apiKey = 'YOUR_API_KEY';
  const cx = 'YOUR_CUSTOM_SEARCH_ENGINE_ID';
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${search}&searchType=image`;

  // Fetches 10 queries each time and return an array [link, width, height]
  return fetch(url)
    .then((response) => response.json())
    .then((data) => {
      const images = data.items.map((item) => [search, item.link]);
      return images;
    })
    .catch((error) => {
      throw new Error('Unable to fetch images.');
    });
};

const selectImageFromSearch = async (search, link) => {
  try {
    // Fetches image locally, turns into an image buffer that is then converted to a
    // Picture object.
    const response = await fetch(`http://localhost:3000/fetch-image?url=${encodeURIComponent(link)}`);
    if (response.ok) {
      const imageBuffer = await response.buffer();
      try {
        const { format, width, height } = await sharp(imageBuffer).metadata();
        const pixelData = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true });
        const pixels = convertFlat(pixelData.data, width, height, pixelData.info.channels);

        // Determine the image mode based on the number of channels.
        let mode = 'RGB';
        if (pixelData.info.channels === 4) {
          mode = 'RGBA';
        }

        // Create a Picture object with the extracted information
        return new Picture(pixels, mode, [width, height], search, format, pixelData.info.channels);
      } catch (error) {
        throw new Error('Failed to process image.');
      }
    } else {
      throw new Error('Failed to fetch image data from the URL.');
    }
  } catch (error) {
    throw new Error('Failed to fetch image from the local server.');
  }
};

const convertFlat = (flatPixels, width, height, components) => {
  // Converts a flat list into a list of lists representing pixels. 
  let pixels = [];

  // Iterate over each row.
  for (let i = 0; i < height; i++) {
    let row = [];
    
    // Iterates over each pixel, grouping components for a singular pixel together.
    for (let j = 0; j < width; j++) {
      const start = (height * i) + (j * components);
      const end = (height * i) + ((j + 1) * components);

      // Add pixel grouping to the row. 
      row.push(flatPixels.slice(start, end));
    }
    pixels.push(row);
  }
  return pixels;
};

const blurImage = (picture, blurRadius) => {  
  // Generate the blur kernel based on the specified blur radius, apply kernel.
  const kernel = generateKernel(blurRadius);
  let blurredImage = picture.blurFilter(kernel);

  // Round and clip to ensure valid values. 
  blurredImage.roundAndClip();
  return blurredImage;
};

const generateKernel = (blurRadius) => {
  // If blur radius is even, increment by 1 to ensure a odd-sized kernel.
  if (blurRadius % 2 === 0) {
    blurRadius += 1;
  }

  const sigma = (blurRadius - 1) / 6;
  let kernel = [];
  const center = Math.floor(blurRadius / 2);
  let sum = 0;

  // Generate kernel values using the Gaussian distribution.
  for (let i = 0; i < blurRadius; i++) {
    kernel[i] = [];
    for (let j = 0; j < blurRadius; j++) {
      // Calculates gaussian value based on distance from center of kernel.
      const x = i - center;
      const y = j - center;
      const exponent = -(x * x + y * y) / (2 * sigma * sigma);
      const value = (1 / (Math.PI * sigma * sigma)) * Math.exp(exponent);

      kernel[i][j] = value;
      sum += value;
    }
  }

  // Normalize kernel values. 
  kernel.forEach((row) => {
    row.forEach((value, j) => {
      row[j] = value / sum;
    });
  });

  return kernel;
};

const saveImage = async (picture) => {
  // takes data from Picture object, saves it as an image-js file

  const { mode, width, height, pixels, filename, format } = picture;

  try {
    // Flatten the pixels from a list of lists to a flat array.
    let flatPixels = [];
    flatPixels = flattenPixels(pixels);
    
    // Creates new image using the image-js library.
    const image = new Image(width, height, flatPixels, { kind: mode });
    await image.save(filename, { format });
  } catch (error) {
    throw new Error('Failed to save image to device.');
  }
};

const flattenPixels = (pixels) => {
  // Flattens list of lists representing pixels into a flat array.
  let flatPixels = [];

  pixels.forEach((row) => {
    row.forEach((singleValue) => {
      flatPixels.push(singleValue);
    });
  });

  return flatPixels;
};

const loadImage = async (filePath) => {
  // Load an image from a file and return a Picture object.

  // Read file data, obtain file type, obtain file name without path.
  const fileData = await fs.promises.readFile(filePath);
  const fileType = await FileType.fromBuffer(fileData);
  const fileName = path.basename(filePath);

  // Check file type is valid with 'image/' MIME type.
  if (fileType && fileType.mime.startsWith('image/')) {
    try {
      // Load image using image-js library.
      const img = await Image.load(fileData);

      // Obtain image data. 
      const width = img.width();
      const height = img.height();
      const mode = img.colorModel();
      const components = img.components();
      
      // convert flat pixels to 2D pixel array.
      const flatPixels = img.data();
      const pixels = convertFlat(flatPixels, width, height, components);
      
      return new Picture(
        pixels,
        mode.toUpperCase(),
        [width, height],
        fileName,
        fileType.ext,
        components
      );
    } catch (error) {
      throw new Error('Failed to load the image.');
    }
  }

  throw new Error('Invalid image file or unsupported image format.');
};

// Export the necessary functions and classes
module.exports = {
  Picture,
  fetchImages,
  selectImageFromSearch,
  loadImage,
  blurImage,
  saveImage,
};
