from ..services.qc import validate_observation
class WeatherObservationAdapter:
    def normalize(self, observations): return [validate_observation(x) for x in observations]
class StationObservationParser:
    def parse(self,row): return row
class ObservationQualityControl:
    def validate(self,obs): return validate_observation(obs)
