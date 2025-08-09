import logging
from ctypes import *
from pathlib import Path

log = logging.getLogger(__name__)

# The source for this DLL is in bin/ImageIndex.
_dll_path = Path(__file__) / '../../..' / 'bin' / 'ImageIndex.dll'
_dll_path = _dll_path.resolve()
try:
    dll = CDLL(str(_dll_path))
except FileNotFoundError:
    log.warn('ImageIndex.dll not available')
    dll = None

available = dll is not None

class ImageSignature:
    def __init__(self, data=None):
        
        if data is None:
            self.data = create_string_buffer(_signature_size)
        else:
            # Load a saved signature.
            assert len(data) == _signature_size
            self.data = create_string_buffer(data, _signature_size)

    def from_param(self):
        return self.data

    def __bytes__(self):
        return self.data.raw

    def __repr__(self):
        return 'ImageSignature'

    def __eq__(self, rhs):
        if not isinstance(rhs, ImageSignature):
            return False

        return self.data.raw == rhs.data.raw

    @classmethod
    def from_image(cls, image):
        """
        Create a signature from a PIL image.
        """
        image = image.resize((ImageIndex.image_size(), ImageIndex.image_size()))
        image = image.convert('RGB')

        image_data = image.tobytes()
        assert len(image_data) == ImageIndex.image_size()*ImageIndex.image_size()*3

        return ImageSignature.from_image_data(image_data)

    @classmethod
    def from_image_data(cls, image_data):
        """
        Create a signature from a 128x128x3 RGB image.
        """
        assert(len(image_data) == _image_size*_image_size*3)

        signature = cls()
        dll.ImageSignature_FromImageData(signature, image_data)
        return signature

class ImageIndex:
    def __init__(self):
        self.index = dll.ImageIndex_Create()

    @staticmethod
    def image_size():
        return _image_size

    def add_image(self, image_id, signature):
        """
        Add an image by ID.  signature is an ImageSignature.
        """
        dll.ImageIndex_AddImage(self.index, image_id, signature)

    def has_image(self, image_id):
        """
        Return true if image_id is in the index.
        """
        return dll.ImageIndex_HasImage(self.index, image_id)

    def remove_image(self, image_id):
        """
        Remove image_id if it's present in the index.
        """
        dll.ImageIndex_RemoveImage(self.index, image_id)

    def image_search(self, signature, max_results=10):
        """
        Search for images similar to image_id, returning an array of dicts:
        {
            'id': similar image ID,
            'score': similarity
        }
        """
        assert signature is not None
        results = (_SearchResult * max_results)()
        count = dll.ImageIndex_ImageSearch(self.index, signature, max_results, results)

        return [{
            'id': results[idx].id,
            'score': results[idx].score,
            'unweighted_score': results[idx].unweighted_score,
        } for idx in range(count)]

    def compare_signatures(self, signature1, signature2):
        """
        Compare two signatures and return a SearchResult with the similarity score.
        """
        result = _SearchResult()
        dll.ImageIndex_CompareSignatures(self.index, signature1, signature2, byref(result))
        
        return {
            'id': 0,
            'score': result.score,
            'unweighted_score': result.unweighted_score,
        }
    
    def __del__(self):
        dll.ImageIndex_Destroy(self.index)

class _SearchResult(Structure):
    _fields_ = [
        ('id', c_ulonglong),
        ('score', c_float),
        ('unweighted_score', c_float),
    ]

if dll is not None:
    # DLL entry points:
    dll.ImageIndex_Create.restype = c_void_p

    dll.ImageIndex_Destroy.restype = None
    dll.ImageIndex_Destroy.argtypes = (c_void_p,)

    dll.ImageIndex_AddImage.argtypes = (c_void_p, c_ulonglong, ImageSignature)
    dll.ImageIndex_AddImage.restype = None

    dll.ImageIndex_RemoveImage.argtypes = (c_void_p, c_ulonglong)
    dll.ImageIndex_RemoveImage.restype = None

    dll.ImageIndex_HasImage.argtypes = (c_void_p, c_ulonglong)
    dll.ImageIndex_HasImage.restype = c_bool

    dll.ImageSignature_FromImageData.restype = None
    dll.ImageSignature_FromImageData.argtypes = (ImageSignature, c_void_p)

    dll.ImageIndex_ImageSearch.restype = c_int
    dll.ImageIndex_ImageSearch.argtypes = (c_void_p, ImageSignature, c_int, POINTER(_SearchResult))

    dll.ImageIndex_CompareSignatures.restype = None
    dll.ImageIndex_CompareSignatures.argtypes = (c_void_p, ImageSignature, ImageSignature, POINTER(_SearchResult))

    _signature_size = dll.ImageSignature_Size()
    _image_size = dll.ImageSignature_ImageSize()

def _test():
    index = ImageIndex()

    from PIL import Image

    with Image.open('test1.png') as image:
        signature = ImageSignature.from_image(image)
    index.add_image(10, signature)

    image = Image.open('test2.png')
    signature = ImageSignature.from_image(image)
    index.add_image(11, signature)

    log.info(index.image_search(10))

    log.info(index.has_image(10))
    index.remove_image(10)
    log.info(index.has_image(10))

if __name__ == '__main__':
    _test()

