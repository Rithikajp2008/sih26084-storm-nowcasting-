import json
from pathlib import Path
class SatelliteProductParser:
    """Parses normalized metadata from MOSDAC-downloaded HDF/NetCDF products.
    Product-specific variable names must be mapped using the product's official format document.
    """
    def parse_metadata(self,path):
        return {'path':str(path),'status':'requires_product_specific_mapping','note':'Use official MOSDAC/INSAT format and ATBD documents for variables/scales.'}
class INSATAdapter:
    def __init__(self,parser=None): self.parser=parser or SatelliteProductParser()
